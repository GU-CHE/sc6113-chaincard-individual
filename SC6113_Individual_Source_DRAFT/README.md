# ChainCard: Transparent Donation DApp

SC6113 **Individual Assignment**. Single campaign, one Solidity contract, MetaMask, HTML/CSS/JS and a read-only Flask backend. Use Sepolia test ETH only.

## Status

- Contract compiled with Solidity 0.8.30, Shanghai EVM, optimizer 200 runs.
- Local Ganache contract checks: 10 passed. Flask checks: 7 passed. Simulated frontend wallet checks: 6 passed.
- 390px browser layout: no horizontal overflow. This is not a physical phone test.
- **Public Sepolia deployment verified:** `0x407299ccD74cE3C20aEf9Cd90cD46DF1e6600731`, block 11890506, transaction `0xf77ef56b9c6bffcff79eb1c2d8076ad4f8f7574f89cadd31ee00d08ef1a0c67e`. Real App donation/withdrawal, Render deployment and final evidence are still pending. The report is a draft until these are completed.
- Existing ChainCard website is not updated by these local files.

## Minimal workflow

1. Open the app, inspect campaign balance, organizer, contract and public history.
2. Connect MetaMask and switch to Sepolia (chain ID 11155111).
3. Enter a positive test ETH donation. MetaMask displays the request and Gas.
4. Confirm; the app shows the transaction hash and polls the Flask receipt API.
5. The organizer (contract deployer) can withdraw a positive amount to their own wallet. Other wallets cannot withdraw.

There is no donor refund, spending verification, token, login, voting or multiple campaign system. Organizer authorization is enforced by `msg.sender` on chain. The backend never signs transactions and stores no wallet keys. On-chain events persist the shared transaction history, so no database is required. The UI returns the latest 30 events in a bounded 5,000-block window; older records can be checked on Sepolia Etherscan. RPC errors never become successful transaction notifications.

## Files

- `contracts/Donation.sol`: campaign contract.
- `static/Donation.json`: generated ABI and bytecode.
- `static/`: frontend and locally bundled ethers 6.15.0 (MIT license included).
- `app.py`: Flask API and static frontend, served from one origin.
- `requirements.txt`: Python dependencies.
- `tests/`: compiler, EVM, API and simulated wallet checks.
- `evidence/`: local test results and layout screenshot, explicitly labeled as local.
- `部署与验收.md`: guided public deployment and screenshot checklist.
- `output/pdf/SC6113_Individual_Report_DRAFT.pdf`: six-page draft; do not submit before finishing public verification.

## Run locally

Python 3.12 is the intended runtime. Environment variables are loaded by the shell or hosting provider, not automatically from `.env`.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export CONTRACT_ADDRESS=0xYourDeployedContractAddress
export DEPLOYMENT_BLOCK=YourDeploymentBlockNumber
.venv/bin/python app.py
```

Open http://127.0.0.1:10000. The verified public contract address and deployment block are read from deployment.json by default. Environment variables override these values. An explicitly empty address disables transaction buttons.

## Reproduce local checks

Node.js 20+ and pnpm are needed for development, not Render runtime:

```sh
pnpm install
node tests/compile.cjs
node tests/contract.cjs
node tests/frontend.cjs
```

`contract.cjs` starts a temporary Ganache chain on localhost port 18545, deploys an isolated contract, runs 10 assertions, and runs the Flask tests against it. It closes the chain after the tests. Generated local addresses/hashes are **not** Sepolia deployment evidence. Native Ganache acceleration is optional; it falls back to JavaScript on unsupported Node builds. The compiler overwrites the generated ABI/bytecode and copies the vendored ethers bundle.

## Render

Create a Python Web Service from this directory/repository. Build: `pip install -r requirements.txt`. Start: `gunicorn --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120 app:app`. Set `RPC_URL`, `CONTRACT_ADDRESS` and `DEPLOYMENT_BLOCK`. Use Free only if available and acceptable to the user; do not select a paid plan automatically. `/health` checks process health and whether settings exist, not RPC availability; `/api/dashboard` verifies the chain and contract. No database credentials are required.

## API

- `GET /api/config`: public network, contract address and ABI.
- `GET /api/dashboard`: organizer, balances/totals, latest confirmed donation/withdrawal events and the queried block window.
- `GET /api/transactions/<hash>`: pending / success / failed for this contract; malformed hashes rejected.
- `GET /health`: process and configuration status.

## Limits

Public RPC outages and provider limits can interrupt reads. A receipt in the current chain is not an irreversible finality guarantee. The organizer controls withdrawals; the app does not prove charitable use. Direct ETH sends are rejected; forced ETH can make the balance differ from recorded donations. Gas applies to every submitted transaction, including failures. A replaced/cancelled pending transaction may need manual Etherscan/MetaMask inspection; stopping local tracking does not cancel a transaction. This classroom prototype has not received an external security audit.

## Sources

- Solidity security considerations: https://docs.soliditylang.org/en/latest/security-considerations.html
- MetaMask transaction guide: https://docs.metamask.io/metamask-connect/evm/guides/send-transactions/
- Assignment requirements: local `SC6113 Individual Assignment.docx` (not the Group Project).
