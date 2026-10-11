"""Read-only Sepolia API and frontend. Wallets sign all transactions locally."""
import json
import os
import re
from pathlib import Path
from flask import Flask, jsonify, send_from_directory
from web3 import Web3

ROOT = Path(__file__).resolve().parent
app = Flask(__name__, static_folder="static", static_url_path="")
app.config.update(MAX_CONTENT_LENGTH=1024)
DEPLOYMENT = json.loads((ROOT / "deployment.json").read_text())
ADDRESS = os.environ.get("CONTRACT_ADDRESS", DEPLOYMENT["contract_address"])
DEPLOYMENT_BLOCK = os.environ.get("DEPLOYMENT_BLOCK", str(DEPLOYMENT["deployment_block"]))
RPC_URL = os.environ.get("RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com")
CHAIN_ID = 11155111
HISTORY_BLOCKS = 5000
w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 10}))
ABI = json.loads((ROOT / "static" / "Donation.json").read_text())["abi"]


def configured():
    return (Web3.is_address(ADDRESS) and int(ADDRESS, 16) != 0
            and DEPLOYMENT_BLOCK.isdecimal())


def contract():
    if not configured():
        raise ValueError("Contract deployment is not configured")
    if w3.eth.chain_id != CHAIN_ID:
        raise ValueError("RPC must use Sepolia")
    address = Web3.to_checksum_address(ADDRESS)
    if not w3.eth.get_code(address):
        raise ValueError("No contract at configured address")
    return w3.eth.contract(address=address, abi=ABI)


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/health")
def health():
    return jsonify(ok=True, configured=configured())


@app.get("/api/config")
def config():
    return jsonify(chain_id=CHAIN_ID, contract_address=ADDRESS if configured() else None,
                   deployment_block=int(DEPLOYMENT_BLOCK) if configured() else None,
                   abi=ABI, configured=configured())


@app.get("/api/dashboard")
def dashboard():
    try:
        c = contract()
        latest = w3.eth.block_number
        start = max(int(DEPLOYMENT_BLOCK), latest - HISTORY_BLOCKS + 1)
        history = []
        # Bounded ranges accommodate public RPC limits; report the history window.
        for low in range(start, latest + 1, 500):
            logs = w3.eth.get_logs({"address": c.address, "fromBlock": low,
                                   "toBlock": min(low + 499, latest),
                                   "topics": [[Web3.to_hex(Web3.keccak(text="Donated(address,uint256)")),
                                               Web3.to_hex(Web3.keccak(text="Withdrawn(address,uint256)"))]]})
            for log in logs:
                is_donation = bytes(log["topics"][0]) == Web3.keccak(text="Donated(address,uint256)")
                history.append({"kind": "donation" if is_donation else "withdrawal",
                                "address": Web3.to_checksum_address("0x" + bytes(log["topics"][1])[-20:].hex()),
                                "amount_wei": str(int.from_bytes(log["data"], "big")),
                                "tx_hash": Web3.to_hex(log["transactionHash"]),
                                "block": log["blockNumber"], "log_index": log["logIndex"]})
        history.sort(key=lambda x: (x["block"], x["log_index"]), reverse=True)
        return jsonify(organizer=c.functions.organizer().call(block_identifier=latest),
                       total_donated_wei=str(c.functions.totalDonated().call(block_identifier=latest)),
                       total_withdrawn_wei=str(c.functions.totalWithdrawn().call(block_identifier=latest)),
                       balance_wei=str(w3.eth.get_balance(c.address, latest)),
                       latest_block=latest, history_from_block=start,
                       history_limited=start > int(DEPLOYMENT_BLOCK), transactions=history[:30])
    except Exception:
        app.logger.exception("Dashboard read failed")
        return jsonify(error="链上数据暂不可用，或尚未配置合约。请稍后重试。"), 503


@app.get("/api/transactions/<tx_hash>")
def transaction(tx_hash):
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", tx_hash):
        return jsonify(error="无效交易哈希。"), 400
    try:
        c = contract()
        from web3.exceptions import TransactionNotFound
        try:
            tx = w3.eth.get_transaction(tx_hash)
        except TransactionNotFound:
            return jsonify(status="pending", tx_hash=tx_hash)
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
        except TransactionNotFound:
            return jsonify(status="pending", tx_hash=tx_hash)
        # Smart wallets may wrap a call in a transaction sent to another address.
        # Failed receipts are terminal even when they have no campaign logs.
        if receipt["status"] == 0:
            return jsonify(status="failed", tx_hash=tx_hash, block=receipt["blockNumber"])
        event_topics = {Web3.keccak(text="Donated(address,uint256)"),
                        Web3.keccak(text="Withdrawn(address,uint256)")}
        campaign_event = any(log["address"].lower() == c.address.lower()
                             and log["topics"] and bytes(log["topics"][0]) in event_topics
                             for log in receipt["logs"])
        direct = tx.get("to") and tx["to"].lower() == c.address.lower()
        if not direct and not campaign_event:
            return jsonify(error="该交易未包含本应用合约的成功操作。"), 404
        return jsonify(status="success", tx_hash=tx_hash, block=receipt["blockNumber"])
    except Exception:
        app.logger.exception("Transaction read failed")
        return jsonify(error="无法确认交易状态，请稍后重试。"), 503


@app.after_request
def headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    if response.mimetype == "application/json":
        response.headers["Cache-Control"] = "no-store"
    return response


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "10000")))
