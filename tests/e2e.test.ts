jest.setTimeout(1000000)
import { BigNumber, constants, Contract, ethers } from 'ethers'
import { createPool, Pool } from 'mariadb';
import chai from 'chai'
const { expect } = chai
import { solidity } from 'ethereum-waffle'
import fs from 'fs'
import { config } from 'dotenv'
import { FunctionFragment } from "ethers/lib/utils";
import keccak256  from 'keccak256';
import { MerkleTree } from 'merkletreejs'
import { postToAPI, signTransaction, WhitelistData } from './utils'

config();
chai.use(solidity)

let pool: Pool
let mainnetContract: Contract
let l2Raffles: Contract 
let l2Tickets: Contract 
let erc20_1_mainnet: Contract 
let erc20_2_mainnet: Contract
let erc20_1_l2: Contract 
let erc20_2_l2: Contract
let erc721: Contract

const mainnetContractAddress = process.env.CONTRACT_ETH
const rafflesContractAddress = process.env.CONTRACT_ARBITRUM
const ticketsContractAddress = process.env.CONTRACT_TICKETS
const erc20_1_mainnetAddress = process.env.CONTRACT_ERC20_1_MAINNET
const erc20_2_mainnetAddress = process.env.CONTRACT_ERC20_2_MAINNET
const erc20_1_l2Address = process.env.CONTRACT_ERC20_1_L2
const erc20_2_l2Address = process.env.CONTRACT_ERC20_2_L2
const erc721_address = process.env.CONTRACT_ERC721

const erc20Abi = JSON.parse(fs.readFileSync(
    './abi/ERC20.json'
).toString()).abi

const erc721Abi = JSON.parse(fs.readFileSync(
    './abi/ERC721.json'
).toString()).abi

const mainnetAbi = JSON.parse(fs.readFileSync(
    './abi/MainnetEscrow.json'
).toString()).abi

const rafflesAbi = JSON.parse(fs.readFileSync(
    './abi/RafflePolygon.json'
).toString()).abi

const ticketsAbi = JSON.parse(fs.readFileSync(
    './abi/RaffleTicketsSystem.json'
).toString()).abi

const interfaceMainnet = new ethers.utils.Interface(mainnetAbi)
const interfaceRaffles = new ethers.utils.Interface(rafflesAbi)
const interfaceTickets = new ethers.utils.Interface(ticketsAbi)
const interfaceERC20 = new ethers.utils.Interface(erc20Abi)
const interfaceERC721 = new ethers.utils.Interface(erc721Abi)
const network = ethers.providers.getNetwork('goerli');
const arbitrumNetwork = ethers.providers.getNetwork('arbitrum-goerli');
const mainnetProvider = new ethers.providers.AlchemyProvider(network, process.env.MAINNET_KEY);
const l2Provider = new ethers.providers.AlchemyProvider(arbitrumNetwork, process.env.ARBITRUM_KEY);
const privateKey = String(process.env.PRIVATE_KEY);
const walletMainnet = new ethers.Wallet(privateKey, mainnetProvider);
const walletL2 = new ethers.Wallet(privateKey, l2Provider)
let address: string 

// Convert to Date
export const unixToDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    return date 
} 

const getLastMinted = () => {
    const lastMinted = fs.readFileSync('lastMinted.txt')
    return lastMinted.toString()
}

const increaseLastMinted = (lastMinted: string) => {
    fs.writeFileSync('lastMinted.txt', BigNumber.from(lastMinted).add(1).toString())
}

const getRaffleFromDb = async () : Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM raffles ORDER BY raffleId DESC LIMIT 1;`)
    await db.release()
    return rows
}

const getLastRaffleId = async () : Promise<string> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT raffleId FROM raffles ORDER BY raffleId DESC LIMIT 1;`)
    await db.release()
    return rows[0].raffleId
}

const getLastValidRaffleId = async () : Promise<string> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT raffleId FROM raffles WHERE raffleState='IN_PROGRESS' ORDER BY raffleId DESC LIMIT 1;`)
    await db.release()
    return rows[0].raffleId
}

const getTicketFromDb = async () : Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM tickets ORDER BY raffleId DESC LIMIT 1;`)
    await db.release()
    return rows
}

const getTicketsFromDb = async (raffleId: BigNumber, account: string) : Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM tickets WHERE raffleId=? AND account=?`, [
        raffleId.toString(), account
    ])
    await db.release()
    return rows
}

const getOrderFromDb = async (raffleId: string, account: string, ticketId: string): Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM orders WHERE seller=? AND ticketId=? AND raffleId=?;`,
    [account, ticketId, raffleId])
    await db.release()
    return rows
}

const getSpecificOrderFromDb = async (raffleId: string) : Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM orders WHERE raffleId=? AND bought='false';`,
    [raffleId])
    await db.release()
    return rows
}

const getOrderFromId = async (orderId: string): Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM orders WHERE orderId=?;`,
    [orderId])
    await db.release()
    return rows
}

const getCompletedOrderFromdb = async (raffleId: string, ticketId: string, boughtBy: string) : Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM orders WHERE raffleId=? AND ticketId=? AND boughtBy=? AND bought='true';`,
    [raffleId, ticketId, boughtBy])
    await db.release()
    return rows
}

const generateMerkleTree = () : WhitelistData => {
    const addresses = fs.readFileSync('./whitelist.txt').toString().split('\n')
    const leafNodes = addresses.map((addr: string) => keccak256(addr))
    const merkleTree = new MerkleTree(leafNodes, keccak256, {sortPairs: true});
    const rootHash = `0x${merkleTree.getRoot().toString("hex")}`;
    
    const whitelistData: WhitelistData = {
        rootHash: rootHash,
        proofForUser: merkleTree.getHexProof(leafNodes[0])
    }
    return whitelistData
}

// mint erc20 tokens
const mintTokens = async (contract: Contract, receiver: string, amount: BigNumber) => {
    await contract.mint(receiver, amount)
}

// approve erc20 tokens
const approveTokens = async (token: Contract, spender: string, amount: BigNumber, network: string) => {
    // approve tokens
    const approveFragment: FunctionFragment = interfaceERC20.getFunction('approve')
    const approveEncodedData = token.interface.encodeFunctionData(
        approveFragment,
        [
            spender,
            amount
        ]
    )

    const approveTx = {
        to: token.address,
        from: network === 'mainnet' ? walletMainnet.address : walletL2.address,
        data: approveEncodedData
    }

    const approveReceipt = network === 'mainnet' ? await walletMainnet.sendTransaction(approveTx) : await walletL2.sendTransaction(approveTx)
    await approveReceipt.wait()
    const approveConfirmation = network === 'mainnet' ? await mainnetProvider.getTransactionReceipt(approveReceipt.hash) : await l2Provider.getTransactionReceipt(approveReceipt.hash)
    expect(approveConfirmation.status).to.be.eq(1)
}

// mint an NFT
const mintNft = async (contract: Contract, receiver: string) : Promise<string> => {
    const lastMinted = getLastMinted()
    const tx = await contract.safeMint(receiver, lastMinted)
    await tx.wait()
    increaseLastMinted(lastMinted)
    return lastMinted
}

// approve an NFT
const approveNft = async (
    erc721Contract: Contract, spender: string, id: string
    ) => {

    const approveFragment: FunctionFragment = interfaceERC721.getFunction('approve')
    const approveEncodedData = erc721.interface.encodeFunctionData(
        approveFragment,
        [
            mainnetContract.address,
            id
        ]
    )
    const approveTx = {
        to: erc721Contract.address,
        from: walletMainnet.address,
        data: approveEncodedData
    }

    const approveReceipt = await walletMainnet.sendTransaction(approveTx)
    await approveReceipt.wait()
    const approveConfirmation = await mainnetProvider.getTransactionReceipt(approveReceipt.hash)
    expect(approveConfirmation.status).to.be.eq(1)
}

const ticketPrice = ethers.utils.parseEther('100')
const raffleCurrency = String(erc20_1_l2Address)
const numberOfTickets = '100'
const duration = 60 * 60 * 12 + 1
const emptyMerkleRoot = ethers.constants.HashZero

// create a raffle
const createRaffle = async (
    raffleType: string, 
    assetRaffled: string, 
    amountOrId: string, 
    merkleRoot: string = emptyMerkleRoot, 
    _raffleCurrency: string = raffleCurrency, 
    _ticketPrice: BigNumber = ticketPrice, 
    _minTickets: BigNumber = BigNumber.from(0),
    _numOfTickets: string = numberOfTickets,
    _duration: number = duration
    ) => {
    const openingFee = await mainnetContract.OPENING_FEE()
    
    const functionFragment: FunctionFragment = raffleType === 'ERC721' ? interfaceMainnet.getFunction('createERC721Raffle') : interfaceMainnet.getFunction('createERC20Raffle')

    const encodedData = mainnetContract.interface.encodeFunctionData(
        functionFragment, 
        [ 
            assetRaffled,
            amountOrId,
            _raffleCurrency,
            _ticketPrice,
            _numOfTickets,
            _minTickets,
            _duration,
            merkleRoot
        ]
    )

    const value = assetRaffled === constants.AddressZero ? openingFee.add(BigNumber.from(amountOrId)) : openingFee
    const transaction = {
        to: mainnetContractAddress,
        from: walletMainnet.address,
        value: value,
        data: encodedData
    }

    const receipt = await walletMainnet.sendTransaction(transaction)
    await receipt.wait()
    
    const confirmation = await mainnetProvider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// create raffle with fair raffle fee
const createRaffleWithFairRaffleFee = async (
    raffleType: string, 
    assetRaffled: string, 
    amountOrId: string, 
    merkleRoot: string = emptyMerkleRoot, 
    _raffleCurrency: string = raffleCurrency, 
    _ticketPrice: BigNumber = ticketPrice, 
    _minTickets: BigNumber = BigNumber.from(0),
    fairRaffleFee: BigNumber = BigNumber.from(0),
    _numberOfTickets: string = numberOfTickets,
    _duration: number = duration
    ) => {
    const openingFee = await mainnetContract.OPENING_FEE()
    
    const functionFragment: FunctionFragment = raffleType === 'ERC721' ? interfaceMainnet.getFunction('createERC721Raffle') : interfaceMainnet.getFunction('createERC20Raffle')

    const encodedData = mainnetContract.interface.encodeFunctionData(
        functionFragment, 
        [ 
            assetRaffled,
            amountOrId,
            _raffleCurrency,
            _ticketPrice,
            _numberOfTickets,
            _minTickets,
            _duration,
            merkleRoot
        ]
    )

    const value = assetRaffled === constants.AddressZero ? openingFee.add(BigNumber.from(amountOrId)) : openingFee
    const transaction = {
        to: mainnetContractAddress,
        from: walletMainnet.address,
        value: value.add(fairRaffleFee),
        data: encodedData
    }

    const receipt = await walletMainnet.sendTransaction(transaction)
    await receipt.wait()
    
    const confirmation = await mainnetProvider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// buy tickets
const buyRaffleTickets = async (raffleId: string, numberOfTickets: BigNumber, proof: string[] = [], valueToSend: string = '0') => {
    const fragmMent: FunctionFragment = interfaceRaffles.getFunction('buyRaffleTicket');

    const encodedData = l2Raffles.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId,
            numberOfTickets,
            proof
        ]
    )

    const transaction = {
        to: rafflesContractAddress,
        from: walletL2.address,
        data: encodedData,
        value: valueToSend
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// put a ticket on resale
const postSellOrder = async (raffleId: string, ticketId: string, currency: string, price: BigNumber) => {
    const fragmMent: FunctionFragment = interfaceTickets.getFunction('postSellOrder');
    const encodedData = l2Tickets.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId,
            ticketId,
            currency,
            price    
        ]
    )

    const transaction = {
        to: l2Tickets.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// buys a resale ticket 
const postBuyOrder = async (raffleId: string, ticketId: string, currency: string, price: BigNumber) => {
    // address _buyer, address _currency, uint256 _price) external payable nonReentrant whenNotPaused {
    const fragmMent: FunctionFragment = interfaceTickets.getFunction('postBuyOrder');
    const encodedData = l2Tickets.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId,
            ticketId,
            walletMainnet.address,
            currency,
            price    
        ]
    )

    const transaction = {
        to: l2Tickets.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// cancel a raffle
const cancelRaffle = async (raffleId: string) : Promise<any> => {
    const fragmMent: FunctionFragment = interfaceRaffles.getFunction('cancelRaffle');
    const encodedData = l2Raffles.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId, 
        ]
    )

    const transaction = {
        to: l2Raffles.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// tickets nonce 
const getTicketsNonce = async (account: string, ticketsContract: Contract) : Promise<BigNumber> => {
    return await ticketsContract.nonce(account)
}

// cancel sell order
const cancelSellOrder = async (raffleId: string, ticketId: string) => {
    const fragmMent: FunctionFragment = interfaceTickets.getFunction('cancelSellOrder');
    const encodedData = l2Tickets.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId,
            ticketId,  
        ]
    )

    const transaction = {
        to: l2Tickets.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

const getCallbacks = async (): Promise<any> => {
    const db = await pool.getConnection()
    const rows = await db.query(`SELECT * FROM callbacks ORDER BY id DESC LIMIT 1;`)
    await db.release()
    return rows
}

// buy ticket with signature
const buyTicketWithSignature = async (
    raffleId: string, ticketId: string, 
    currency: string, price: string, 
    buyer: string, r: any, s: any, v: any
    ) => {
        const fragmMent: FunctionFragment = interfaceTickets.getFunction('buyTicketWithSignature');
        const encodedData = l2Tickets.interface.encodeFunctionData(
            fragmMent, 
            [ 
                raffleId, 
                ticketId,
                currency, 
                price,
                buyer, 
                r,
                s,
                v
            ]
        )
    
        const transaction = {
            to: l2Tickets.address,
            from: walletL2.address,
            data: encodedData
        }
    
        const receipt = await walletL2.sendTransaction(transaction)
        await receipt.wait()
        const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
        expect(confirmation.status).to.be.eq(1)
}

const claimCancelledRaffle = async (raffleId: string, ticketIds: string[]) => {
    const fragmMent: FunctionFragment = interfaceRaffles.getFunction('claimCancelledRaffle');
    const encodedData = l2Raffles.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId, 
            ticketIds
        ]
    )

    const transaction = {
        to: l2Raffles.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// claim a completed raffle
const claimRaffle = async (raffleId: string) => {
    const fragmMent: FunctionFragment = interfaceRaffles.getFunction('claimRaffle');
    const encodedData = l2Raffles.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId, 
        ]
    )

    const transaction = {
        to: l2Raffles.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

// complete a raffle
const completeRaffle = async (raffleId: string) => {
    const fragmMent: FunctionFragment = interfaceRaffles.getFunction('completeRaffle');
    const encodedData = l2Raffles.interface.encodeFunctionData(
        fragmMent, 
        [ 
            raffleId, 
        ]
    )

    const transaction = {
        to: l2Raffles.address,
        from: walletL2.address,
        data: encodedData
    }

    const receipt = await walletL2.sendTransaction(transaction)
    await receipt.wait()
    const confirmation = await l2Provider.getTransactionReceipt(receipt.hash)
    expect(confirmation.status).to.be.eq(1)
}

describe('e2e', () => {
    beforeAll(async () => {
        const db_config = {
            host: process.env.DB_ADDRESS,
            user: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            connectionLimit: 1 
        }
        
        // connect to DB
        pool = createPool(db_config);

        address = await walletMainnet.getAddress();

        mainnetContract = new ethers.Contract(
            String(mainnetContractAddress),
            mainnetAbi,
            walletMainnet
        )

        l2Raffles = new ethers.Contract(
            String(rafflesContractAddress),
            rafflesAbi,
            walletL2
        )

        l2Tickets = new ethers.Contract(
            String(ticketsContractAddress),
            ticketsAbi,
            walletL2
        )

        erc20_1_mainnet = new ethers.Contract(
            String(erc20_1_mainnetAddress),
            erc20Abi,
            walletMainnet
        )

        erc20_2_mainnet = new ethers.Contract(
            String(erc20_2_mainnetAddress),
            erc20Abi,
            walletMainnet
        )

        erc20_1_l2 = new ethers.Contract(
            String(erc20_1_l2Address),
            erc20Abi,
            walletL2
        )

        erc20_2_l2 = new ethers.Contract(
          String(erc20_2_l2Address),
          erc20Abi,
          walletL2
        )

        erc721 = new ethers.Contract(
            String(erc721_address),
            erc721Abi,
            walletMainnet
        )
    })

    it('creates a ERC721 raffle', async () => {
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)
        // create raffle
        await createRaffle('ERC721', erc721.address, lastMinted)
        // wait
        await new Promise((r) => setTimeout(r, 80000));
        // get data from db
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount).to.be.eq(lastMinted)
        expect(raffleData.pricePerTicket).to.be.eq(ticketPrice)
        expect(raffleData.raffleType).to.be.eq('ERC721')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
    })

    it('buys a ticket (ERC721)', async () => {
        // approve amount 
        await approveTokens(erc20_1_l2, l2Raffles.address, ticketPrice, 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy the ticket
        await buyRaffleTickets(raffleId, BigNumber.from(1))
        // wait 
        await new Promise((r) => setTimeout(r, 120000))
        // check db 
        const ticketData = await getTicketFromDb()
        // confirm correctness
        expect(ticketData.length).to.be.eq(1)
        expect(ticketData[0].raffleId).to.be.eq(raffleId)
        expect(ticketData[0].account).to.be.eq(walletL2.address) 
        expect(ticketData[0].ticketID).to.be.eq('0')
    })

    it('creates an ERC20 raffle', async () => {
        // 100 tokens 
        const erc20RaffleQuantity = ethers.utils.parseUnits('100')
        // mint tokens
        await mintTokens(erc20_1_mainnet, walletMainnet.address, erc20RaffleQuantity)
        // approve tokens
        await approveTokens(erc20_1_mainnet, mainnetContract.address, erc20RaffleQuantity, 'mainnet')
        // create raffle
        await createRaffle('ERC20', erc20_1_mainnet.address, erc20RaffleQuantity.toString())
        // wait
        await new Promise((r) => setTimeout(r, 60000));
        // get db data
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount.toString()).to.be.eq(erc20RaffleQuantity.toString())
        expect(raffleData.pricePerTicket).to.be.eq(ticketPrice.toString())
        expect(raffleData.raffleType).to.be.eq('ERC20')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.raffleState).to.be.eq('IN_PROGRESS')
        expect(raffleData.raffleOwner).to.be.eq(walletMainnet.address)
    }) 

    it('buys multiple tickets (ERC20)', async () => {
        // how many to buy
        const ticketsToBuy = BigNumber.from(6)
        // mint tokens 
        await mintTokens(erc20_1_l2, walletL2.address, ticketsToBuy.mul(ticketPrice))
        // approve tokens
        await approveTokens(erc20_1_l2, l2Raffles.address, ticketsToBuy.mul(ticketPrice), 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy
        await buyRaffleTickets(raffleId, ticketsToBuy)
        // wait
        await new Promise((r) => setTimeout(r, 120000));
        // check db 
        const ticketsData = await getTicketsFromDb(BigNumber.from(raffleId), walletMainnet.address)
        expect(ticketsData.length).to.be.gt(0)
        // confirm 
        for (let i = 0; i < ticketsToBuy.toNumber(); i++) {
            const ticket = ticketsData[i]
            expect(ticket.raffleId).to.be.eq(raffleId)
            expect(ticket.account).to.be.eq(walletL2.address) 
            expect(ticket.ticketID).to.be.eq(i.toString())
        }
    })

    it('creates a whitelisted raffle', async () => {
        // create merkle tree
        const whitelistData: WhitelistData = generateMerkleTree()
        // mint nft
        const lastMinted = await mintNft(erc721, walletMainnet.address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)
        // create 
        await createRaffle('ERC721', erc721.address, lastMinted, whitelistData.rootHash)
        // wait
        await new Promise((r) => setTimeout(r, 12000));
        // check db
        const dbData = await getRaffleFromDb()
        // confirm 
        expect(dbData.length).to.be.gt(0)
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount.toString()).to.be.eq(lastMinted.toString())
        expect(raffleData.pricePerTicket).to.be.eq(ticketPrice)
        expect(raffleData.raffleType).to.be.eq('ERC721')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.raffleState).to.be.eq('IN_PROGRESS')
        expect(raffleData.raffleOwner).to.be.eq(walletMainnet.address)
        expect(raffleData.merkleRoot).to.be.eq(whitelistData.rootHash) 
    })

    it('buys a whitelisted raffle tickets', async () => {
        const ticketsToBuy = BigNumber.from(1)
        const whitelistData: WhitelistData = generateMerkleTree()
        // mint tokens 
        await mintTokens(erc20_1_l2, walletL2.address, ticketsToBuy.mul(ticketPrice))
        // approve tokens
        await approveTokens(erc20_1_l2, l2Raffles.address, ticketsToBuy.mul(ticketPrice), 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy
        await buyRaffleTickets(raffleId, ticketsToBuy, whitelistData.proofForUser)
        // wait
        await new Promise((r) => setTimeout(r, 120000));
        // check db 
        const ticketsData = await getTicketsFromDb(raffleId, walletMainnet.address)
        expect(ticketsData.length).to.be.eq(ticketsToBuy.toNumber())
        // confirm 
        for (let i = 0; i < ticketsToBuy.toNumber(); i++) {
            const ticket = ticketsData[i]
            expect(ticket.raffleId).to.be.eq(raffleId)
            expect(ticket.account).to.be.eq(walletL2.address) 
            expect(ticket.ticketID).to.be.eq(i.toString())
        }
    })

    it('creates an ERC20 raffle with native token as payment currency', async () => {
        const _ticketPrice = ethers.utils.parseEther('0.0001')
        await mintTokens(erc20_1_mainnet, walletL2.address, BigNumber.from(100))
        await approveTokens(erc20_1_mainnet, mainnetContract.address, BigNumber.from(100), 'mainnet')
        await createRaffle('ERC20', erc20_1_mainnet.address, BigNumber.from(100).toString(),
        constants.HashZero, constants.AddressZero, _ticketPrice, BigNumber.from(0))
        // wait
        await new Promise((r) => setTimeout(r, 60000));
        // get data from db
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount).to.be.eq('100')
        expect(raffleData.pricePerTicket).to.be.eq(_ticketPrice)
        expect(raffleData.raffleType).to.be.eq('ERC20')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.currency).to.be.eq(ethers.constants.AddressZero)
    })

    it('creates an ERC721 raffle with native token as payment currency', async () => {
        const _ticketPrice = ethers.utils.parseEther('0.0001')
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)
        
        await createRaffle(
            'ERC721', erc721.address, lastMinted, 
            ethers.constants.HashZero, ethers.constants.AddressZero, _ticketPrice
        )
        // wait
        await new Promise((r) => setTimeout(r, 60000));
        // get data from db
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount).to.be.eq(lastMinted)
        expect(raffleData.pricePerTicket).to.be.eq(_ticketPrice.toString())
        expect(raffleData.raffleType).to.be.eq('ERC721')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.currency).to.be.eq(ethers.constants.AddressZero)
    })

    it('buys multiple tickets with ether as a payment currency', async () => {
        const ticketsToBuy = BigNumber.from(1)
        const _ticketPrice = ethers.utils.parseEther('0.0001')
      
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy
        await buyRaffleTickets(raffleId, ticketsToBuy, [], _ticketPrice.toString())
        // wait
        await new Promise((r) => setTimeout(r, 120000));
        // check db 
        const ticketsData = await getTicketsFromDb(raffleId, walletMainnet.address)
        expect(ticketsData.length).to.be.eq(ticketsToBuy.toNumber())
        // confirm 
        for (let i = 0; i < ticketsToBuy.toNumber(); i++) {
            const ticket = ticketsData[i]
            expect(ticket.raffleId).to.be.eq(raffleId)
            expect(ticket.account).to.be.eq(walletL2.address) 
            expect(ticket.ticketID).to.be.eq(i.toString())
        }
    })

    it('creates a ERC20 raffle with Ether as raffled amount', async () => {
        await createRaffle(
            'ERC20', ethers.constants.AddressZero, ethers.utils.parseEther('0.0001').toString(), 
            ethers.constants.HashZero, ethers.constants.AddressZero, 
            ethers.utils.parseEther('0.0001')
        )
        // wait
        await new Promise((r) => setTimeout(r, 80000));
        // get data from db
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount).to.be.eq(ethers.utils.parseEther('0.0001').toString())
        expect(raffleData.pricePerTicket).to.be.eq(ethers.utils.parseEther('0.0001').toString())
        expect(raffleData.raffleType).to.be.eq('ERC20')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.currency).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.assetContract).to.be.eq(ethers.constants.AddressZero)
    })

    it('cancels a raffle', async () => {
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)
        // create raffle
        await createRaffle('ERC721', erc721.address, lastMinted)
        // wait
        await new Promise((r) => setTimeout(r, 60000));
        const raffleId = await getLastRaffleId()
        await cancelRaffle(raffleId)
        await new Promise((r) => setTimeout(r, 60000));
        const raffle = await getRaffleFromDb()
        expect(raffle.length).to.be.gt(0)
        expect(raffle[0].raffleState).to.be.eq('REFUNDED')

        // check that we get the callback in the db 
        const callback = await getCallbacks()
        expect(callback.length).to.be.gt(0)
        expect(callback[0].amountOrNftIdToReceiver).to.be.eq(lastMinted)
        expect(callback[0].isERC721).to.be.eq('true')
        expect(callback[0].assetContract).to.be.eq(erc721.address)
    })

    it('puts a ticket on sale', async () => {
        const lastRaffleId = await getLastRaffleId()
        // approve
        await approveTokens(erc20_1_l2, l2Raffles.address, BigNumber.from(ticketPrice).mul(5), 'l2')
        // buy tickets
        await buyRaffleTickets(lastRaffleId, BigNumber.from(1))
        await new Promise((r) => setTimeout(r, 60000));
        const tickets = await getTicketsFromDb(BigNumber.from(lastRaffleId), walletMainnet.address)
        // put on resale
        await postSellOrder(
            lastRaffleId, tickets[0].ticketID, 
            erc20_1_l2.address, BigNumber.from(100))
        // get orders
        await new Promise((r) => setTimeout(r, 60000));
        const order = await getOrderFromDb(lastRaffleId, walletL2.address, tickets[0].ticketID)
        expect(order.length).to.be.gt(0)
        expect(order[0].ticketId).to.be.eq(tickets[0].ticketID)
        expect(order[0].raffleId).to.be.eq(lastRaffleId)
        expect(order[0].currency).to.be.eq(erc20_1_l2.address)
        expect(order[0].bought).to.be.eq('false')
        expect(order[0].boughtBy).to.be.eq("0")
        expect(order[0].price).to.be.eq('100')
    })

    it('buys a resale ticket', async () => {
        const lastRaffleId = await getLastRaffleId()
        const order = await getSpecificOrderFromDb(lastRaffleId)
        expect(order.length).to.be.gt(0)
        await postBuyOrder(lastRaffleId, order[0].ticketId, order[0].currency, BigNumber.from(order[0].price))
        await new Promise((r) => setTimeout(r, 60000));
        const finishedOrder = await getCompletedOrderFromdb(lastRaffleId,
            order[0].ticketId, walletMainnet.address)

        expect(finishedOrder.length).to.be.gt(0)
        expect(finishedOrder[0].boughtBy).to.be.eq(walletMainnet.address)
        expect(finishedOrder[0].currency).to.be.eq(order[0].currency)
    })

    it('puts a ticket on sale a second time', async () => {
        const lastRaffleId = await getLastRaffleId()
        // approve
        await approveTokens(erc20_1_l2, l2Raffles.address, BigNumber.from(ticketPrice).mul(5), 'l2')
        // buy tickets
        await buyRaffleTickets(lastRaffleId, BigNumber.from(1))
        await new Promise((r) => setTimeout(r, 60000));
        const tickets = await getTicketsFromDb(BigNumber.from(lastRaffleId), walletMainnet.address)
        // put on resale
        await postSellOrder(
            lastRaffleId, tickets[0].ticketID, 
            erc20_1_l2.address, BigNumber.from(100))
        // get orders
        await new Promise((r) => setTimeout(r, 60000));
        const order = await getOrderFromDb(lastRaffleId, walletL2.address, tickets[0].ticketID)
        expect(order.length).to.be.gt(0)
        expect(order[0].ticketId).to.be.eq(tickets[0].ticketID)
        expect(order[0].raffleId).to.be.eq(lastRaffleId)
        expect(order[0].currency).to.be.eq(erc20_1_l2.address)
        expect(order[0].bought).to.be.eq('false')
        expect(order[0].boughtBy).to.be.eq("0")
        expect(order[0].price).to.be.eq('100')

        // put on resale
        await postSellOrder(
            lastRaffleId, tickets[0].ticketID, 
            erc20_1_l2.address, BigNumber.from(200))
            await new Promise((r) => setTimeout(r, 60000));
        const order_2 = await getOrderFromDb(lastRaffleId, walletL2.address, tickets[0].ticketID)
        expect(order_2.length).to.be.gt(0)
        expect(order_2[0].ticketId).to.be.eq(tickets[0].ticketID)
        expect(order_2[0].raffleId).to.be.eq(lastRaffleId)
        expect(order_2[0].currency).to.be.eq(erc20_1_l2.address)
        expect(order_2[0].bought).to.be.eq('false')
        expect(order_2[0].boughtBy).to.be.eq("0")
        expect(order_2[0].price).to.be.eq('200') 

        // make sure the previous order was overriden
        const previousOrder = await getOrderFromId(order[0].orderId)
        expect(previousOrder.length).to.be.eq(0)
    })

    it.skip('puts a ticket on sale with signature', async () => {
        //signTransaction
        const lastRaffleId = await getLastRaffleId()
        // // approve
        // await approveTokens(erc20_1_l2, l2Raffles.address, BigNumber.from(ticketPrice).mul(5), 'l2')
        // // buy tickets
        // await buyRaffleTickets(lastRaffleId, BigNumber.from(1))
        // await new Promise((r) => setTimeout(r, 60000));
        const tickets = await getTicketsFromDb(BigNumber.from(lastRaffleId), walletMainnet.address)
        expect(tickets.legth).to.be.gt(0)
        const nonce = await getTicketsNonce(walletL2.address, l2Tickets)
        const name = await erc20_1_l2.name()
        const decimals = await erc20_1_l2.decimals()

        // create signature
        const signature = await signTransaction(
            network.chainId,
            walletMainnet.address,
            parseInt(lastRaffleId),
            tickets[0].ticketID,
            erc20_1_l2.address,
            BigNumber.from(100).toNumber(),
            nonce.toNumber(),
            walletL2
        )

        console.log(signature)

        const data = {
            currency: erc20_1_l2.address,
            price: BigNumber.from(100).toString(),
            raffleId: lastRaffleId,
            ticketId: tickets[0].ticketID,
            signature: signature,
            boughtBy: walletMainnet.address,
            seller: walletMainnet.address,
            currencyName: name,
            currencyDecimals: decimals 
        }
        
        // send to api 
        const response = await postToAPI(data)
        expect(response).to.be.eq(200)

        await new Promise((r) => setTimeout(r, 30000));

        const _signature = signature.substring(2)
        const r = '0x' + _signature.substring(0, 64)
        const s = '0x' + _signature.substring(64, 128)
        const v = parseInt(_signature.substring(128, 130), 16)

        // buy ticket 
        /*
            network.chainId,
            walletMainnet.address,
            parseInt(lastRaffleId),
            tickets[0].ticketID,
            erc20_1_l2.address,
            BigNumber.from(100).toNumber(),
            nonce.toNumber(),
            walletL2
        */
        await buyTicketWithSignature(
            data.raffleId,
            data.ticketId,
            data.currency,
            data.price,
            data.boughtBy,
            r,
            s,
            v
        )

        await new Promise((r) => setTimeout(r, 60000));

        const order = await getCompletedOrderFromdb(
            data.raffleId,
            data.ticketId,
            data.boughtBy
        )
        expect(order.length).to.be.gt(0)
        expect(order[0].signature).to.be.eq(signature)
    })

    it('cancels a sell order', async () => {
        const _ticketPrice = '1234567'
        const lastRaffleId = await getLastValidRaffleId()
        // approve
        await approveTokens(erc20_1_l2, l2Raffles.address, BigNumber.from(ticketPrice).mul(5), 'l2')
        // buy tickets
        await buyRaffleTickets(lastRaffleId, BigNumber.from(1))
        await new Promise((r) => setTimeout(r, 60000));
        const tickets = await getTicketsFromDb(BigNumber.from(lastRaffleId), walletMainnet.address)
        // put on resale
        await postSellOrder(
            lastRaffleId, tickets[0].ticketID, 
            erc20_1_l2.address, BigNumber.from(_ticketPrice))
        // get orders
        await new Promise((r) => setTimeout(r, 60000));
        const order = await getOrderFromDb(lastRaffleId, walletL2.address, tickets[0].ticketID)
        expect(order.length).to.be.gt(0)
        expect(order[0].ticketId).to.be.eq(tickets[0].ticketID)
        expect(order[0].raffleId).to.be.eq(lastRaffleId)
        expect(order[0].currency).to.be.eq(erc20_1_l2.address)
        expect(order[0].bought).to.be.eq('false')
        expect(order[0].boughtBy).to.be.eq("0")
        expect(order[0].price).to.be.eq(_ticketPrice)

        // cancel 
        await cancelSellOrder(lastRaffleId, tickets[0].ticketID)

        await new Promise((r) => setTimeout(r, 60000));
        // confirm is gone
        const previousOrder = await getOrderFromId(order[0].orderId)
        expect(previousOrder.length).to.be.eq(0)
    })

    it('creates an ERC20 raffle with fair raffle fee', async () => {
        // 100 tokens 
        const erc20RaffleQuantity = BigNumber.from('100')
        // mint tokens
        await mintTokens(erc20_1_mainnet, walletMainnet.address, erc20RaffleQuantity)
        // approve tokens
        await approveTokens(erc20_1_mainnet, mainnetContract.address, erc20RaffleQuantity, 'mainnet')
        // create raffle
        await createRaffleWithFairRaffleFee('ERC20', erc20_1_mainnet.address, erc20RaffleQuantity.toString(), constants.HashZero, erc20_1_l2.address, erc20RaffleQuantity, BigNumber.from('5'))
        // wait
        await new Promise((r) => setTimeout(r, 60000));
        // get db data
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount.toString()).to.be.eq(erc20RaffleQuantity.toString())
        expect(raffleData.pricePerTicket).to.be.eq(erc20RaffleQuantity.toString())
        expect(raffleData.raffleType).to.be.eq('ERC20')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)
        expect(raffleData.raffleState).to.be.eq('IN_PROGRESS')
        expect(raffleData.raffleOwner).to.be.eq(walletMainnet.address)
    })

    it('creates a raffle with fair raffle fee', async () => {
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)

        // get the fair raffle fee
        // address _currencyInPolygon, uint128 _pricePerTicket, uint64 _minimumTicketsSold
        const fee = await mainnetContract.fairRaffleFeeERC721(
            erc20_1_l2.address,
            BigNumber.from('1000'),
            BigNumber.from('2')
        )

        // create raffle
        await createRaffleWithFairRaffleFee('ERC721', erc721.address, lastMinted, constants.HashZero,
        erc20_1_l2.address, BigNumber.from('1000'), BigNumber.from(2), fee)
        // wait
        await new Promise((r) => setTimeout(r, 80000));
        // get data from db
        const dbData = await getRaffleFromDb()
        expect(dbData.length).to.be.gt(0)
        // confirm
        const raffleData = dbData[0]
        expect(raffleData.nftIdOrAmount).to.be.eq(lastMinted)
        expect(raffleData.pricePerTicket).to.be.eq(BigNumber.from('1000').toString())
        expect(raffleData.raffleType).to.be.eq('ERC721')
        expect(raffleData.raffleWinner).to.be.eq(ethers.constants.AddressZero)

        // buy a ticket 
        // approve amount 
        await approveTokens(erc20_1_l2, l2Raffles.address, BigNumber.from('1000'), 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy the ticket
        await buyRaffleTickets(raffleId, BigNumber.from(1))
        // wait 
        await new Promise((r) => setTimeout(r, 60000))
        // check db 
        const ticketData = await getTicketFromDb()
        // confirm correctness
        expect(ticketData.length).to.be.eq(1)
        expect(ticketData[0].raffleId).to.be.eq(raffleId)
        expect(ticketData[0].account).to.be.eq(walletL2.address) 
        expect(ticketData[0].ticketID).to.be.eq('0')
    })

    it('completes a raffle and awards a winner', async () => {
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)
        // create raffle
        await createRaffle(
            'ERC721', 
            erc721.address, 
            lastMinted, 
            constants.HashZero,
            erc20_1_l2.address,
            ticketPrice,
            BigNumber.from(0),
            '2'
        )
        // wait
        await new Promise((r) => setTimeout(r, 60000));
       
        // approve amount 
        await approveTokens(erc20_1_l2, l2Raffles.address, ticketPrice.mul(2), 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()

        // buy the ticket
        await buyRaffleTickets(raffleId, BigNumber.from(2))
        // wait 
        await new Promise((r) => setTimeout(r, 60000))

        // close raffle
        await completeRaffle(raffleId)

        await new Promise((r) => setTimeout(r, 60000))

        const balanceBefore = await erc20_1_l2.balanceOf(walletL2.address)

        await claimRaffle(raffleId)

        await new Promise((r) => setTimeout(r, 60000))

        const raffleData = await getRaffleFromDb()

        expect(raffleData.length).to.be.gt(0)
        expect(raffleData[0].raffleState).to.be.eq('CLAIMED')

        const balanceAfter = await erc20_1_l2.balanceOf(walletL2.address)

        expect(balanceAfter).to.be.gt(balanceBefore)
    })

    it('claims a refund on a raffle', async () => {
        // mint nft
        const lastMinted = await mintNft(erc721, address)
        // approve
        await approveNft(erc721, mainnetContract.address, lastMinted)

        // get the fair raffle fee
        // address _currencyInPolygon, uint128 _pricePerTicket, uint64 _minimumTicketsSold
        const fee = await mainnetContract.fairRaffleFeeERC721(
            erc20_1_l2.address,
            BigNumber.from('1000'),
            BigNumber.from('3')
        )
        // create raffle
        await createRaffleWithFairRaffleFee(
            'ERC721', 
            erc721.address, 
            lastMinted, 
            constants.HashZero,
            erc20_1_l2.address,
            BigNumber.from('1000'),
            BigNumber.from(3),
            fee,
            '4',
            60 * 2
        )
        // wait
        await new Promise((r) => setTimeout(r, 40000));
        // approve amount 
        await approveTokens(erc20_1_l2, l2Raffles.address, ticketPrice.mul(2), 'l2')
        // get the raffle id
        const raffleId = await getLastRaffleId()
        // buy the ticket
        await buyRaffleTickets(raffleId, BigNumber.from(2))  

        // wait
        await new Promise((r) => setTimeout(r, 80000));
        
        await completeRaffle(raffleId)

        await new Promise((r) => setTimeout(r, 40000));

        const balanceBefore = await erc20_1_l2.balanceOf(walletL2.address)
        
        await claimCancelledRaffle(raffleId, ['0', '1'])

        const balanceAfter = await erc20_1_l2.balanceOf(walletL2.address)
        expect(balanceAfter).to.be.gt(balanceBefore)
    })
})

