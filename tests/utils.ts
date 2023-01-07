import dotenv from 'dotenv'
import { ethers, Signer } from 'ethers'
import axios from 'axios'
dotenv.config()

export interface WhitelistData {
    rootHash: string
    proofForUser: string[]
}

// Utils 
const typedData = {
    types: {
        Ballot: [
            { name: "buyer" , type: "address" },
            { name: "raffleId", type: "uint256" },
            { name: "ticketId", type: "uint256" },
            { name: "currency", type: "address" },
            { name: "price", type: "uint128" },
            { name: "nonce", type: "uint256" }
        ],
    },
    domain: {
        name: "RaffleTicketSystem",
        version: "1",
        chainId: 1,
        verifyingContract: process.env.CONTRACT_TICKETS,
    },
    primaryType: "Ballot",
    message: {
        buyer: "",
        raffleId: 0,
        ticketId: 0,
        currency: "",
        price: 0,
        nonce: ""
    },
}

// Replace the signature data
function replaceData(
    chainId: number,
    buyer: string,
    raffleId: number,
    ticketId: number,
    currency: string,
    price: number,
    nonce: string 
    ) {
    typedData.domain.chainId = chainId;
    typedData.message.buyer = buyer 
    typedData.message.raffleId = raffleId 
    typedData.message.ticketId = ticketId 
    typedData.message.currency = currency 
    typedData.message.price = price 
    typedData.message.nonce = nonce 
}

export const signTransaction = async (
    chainId: number,
    buyer: string, 
    raffleId: number,
    ticketId: number,
    currency: string,
    price: number,
    nonce: number,
    signer: Signer
) : Promise<string> => {
    try {
        replaceData(chainId, buyer, raffleId, ticketId, currency, price, nonce.toString());
    
        const wallet = new ethers.Wallet(String(process.env.PRIVATE_KEY))    
        const signedData = await wallet._signTypedData(typedData.domain, typedData.types, typedData.message)
        return signedData;
    } catch (e) {
        console.log(e)
        return ''
    }
}

const client = axios.create({
    baseURL: 'http://localhost:8000/'
})

export const postToAPI = async (data: any) => {
    const response = await client.post('signatures', data)
    return response.status 
}