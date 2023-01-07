# RaffleFi e2e tests

A repo with e2e tests for RaffleFi. This requires all other services to be up, as well as all required details filled in the .env file. 

## Installation

Install the required packages with `yarn` or `npm install`

## Usage

Fill the `.env` file (`cp .env-template .env`)

```bash
# DB
DB_ADDRESS=
DB_PORT=
DB_USERNAME=
DB_PASSWORD=
DB_NAME=
# Wallet
PRIVATE_KEY=
WALLET_ADDRESS=
# Providers
MAINNET_KEY=
MAINNET_RPC=
MUMBAI_KEY=
MUMBAI_RPC=
ARBITRUM_KEY=
ARBITRUM_RPC=
# Contracts
CONTRACT_ETH=
CONTRACT_MUMBAI=
CONTRACT_ARBITRUM=
CONTRACT_TICKETS=
```

To run the tests you can simply use 

`yarn test` or `yarn start`
