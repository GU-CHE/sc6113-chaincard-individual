'use strict';
const $ = id => document.getElementById(id);
const EXPLORER = 'https://sepolia.etherscan.io';
const CHAIN_HEX = '0xaa36a7';
let settings, snapshot, account, busy = false;
const pendingKey = 'chaincard-sepolia-pending';
const iface = () => new ethers.Interface(settings.abi);
function status(id, text, kind = '') { $(id).textContent = text; $(id).className = `status ${kind}`; }
function eth(value) { return ethers.formatEther(BigInt(value)); }
function amount(value) {
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,18})?$/.test(value.trim())) throw new Error('请输入正数，最多 18 位小数，不使用科学计数法。');
  const wei = ethers.parseEther(value.trim());
  if (wei <= 0n) throw new Error('金额必须大于 0。');
  return wei;
}
function controls() {
  const disabled = busy || !account || !settings?.configured || !snapshot;
  $('donate-button').disabled = disabled;
  $('withdraw-button').disabled = disabled;
  $('connect-button').disabled = busy;
  $('withdraw-area').hidden = !account || account.toLowerCase() !== snapshot?.organizer.toLowerCase();
}
async function api(path) {
  const response = await fetch(path, {signal: AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '服务暂不可用。');
  return data;
}
function errorText(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return '你取消了钱包请求，没有发送交易。';
  if (error.code === -32002) return '钱包已有待处理请求，请打开 MetaMask 完成或取消。';
  return error.shortMessage || error.message || '操作失败，请重试。';
}
async function refresh() {
  status('data-status', '正在读取 Sepolia…');
  try {
    snapshot = await api('/api/dashboard');
    $('donated').textContent = eth(snapshot.total_donated_wei);
    $('balance').textContent = eth(snapshot.balance_wei);
    $('withdrawn').textContent = eth(snapshot.total_withdrawn_wei);
    $('organizer').textContent = snapshot.organizer;
    const list = $('transaction-list'); list.replaceChildren();
    for (const tx of snapshot.transactions) {
      const card = document.createElement('article'); card.className = 'transaction-card';
      const title = document.createElement('strong'); title.textContent = `${tx.kind === 'donation' ? '捐款' : '提款'} · ${eth(tx.amount_wei)} ETH`;
      const detail = document.createElement('p'); detail.textContent = `地址：${tx.address} · 区块 ${tx.block} · 已确认`;
      const link = document.createElement('a'); link.href = `${EXPLORER}/tx/${tx.tx_hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = tx.tx_hash;
      card.append(title, detail, link); list.append(card);
    }
    if (!snapshot.transactions.length) list.textContent = '当前查询范围内还没有捐款或提款。';
    $('history-note').textContent = `最新 30 条已确认记录；查询区块 ${snapshot.history_from_block}–${snapshot.latest_block}。${snapshot.history_limited ? '更早记录请通过合约的 Etherscan 页面查看。' : ''}`;
    status('data-status', `数据来自 Flask 后端 · 区块 ${snapshot.latest_block}`, 'success');
  } catch (error) {
    snapshot = null;
    status('data-status', errorText(error), 'error');
  }
  controls();
}
async function connect() {
  try {
    if (!window.ethereum) throw new Error('未检测到钱包。请安装 MetaMask，或用其手机内置浏览器打开。');
    const accounts = await window.ethereum.request({method:'eth_requestAccounts'});
    if (!accounts.length) throw new Error('钱包没有授权账户。');
    if (await window.ethereum.request({method:'eth_chainId'}) !== CHAIN_HEX) {
      await window.ethereum.request({method:'wallet_switchEthereumChain', params:[{chainId:CHAIN_HEX}]});
    }
    account = (await window.ethereum.request({method:'eth_accounts'}))[0];
    status('wallet-status', `Sepolia 已连接：${account}`, 'success');
  } catch (error) { account = null; status('wallet-status', errorText(error), 'error'); }
  controls();
}
function showHash(hash) { $('clear-pending').hidden = false; $('tx-link').hidden = false; $('tx-link').href = `${EXPLORER}/tx/${hash}`; }
async function track(hash) {
  showHash(hash);
  status('tx-status', '交易已发送，正在等待链上确认…');
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await api(`/api/transactions/${hash}`);
      if (result.status !== 'pending') {
        localStorage.removeItem(pendingKey);
        $('clear-pending').hidden = true;
        status('tx-status', result.status === 'success' ? '交易成功，已写入区块链。' : '交易失败，链上状态已回滚；Gas 仍可能被扣除。', result.status === 'success' ? 'success' : 'error');
        await refresh(); return;
      }
    } catch (_) { /* Keep hash when RPC is unavailable; never report success. */ }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  status('tx-status', '暂未确认。请通过下方链接检查；点击“刷新链上数据”可再次查询。不要重复发送。', 'error');
}
async function transact(kind, value) {
  if (busy) return;
  busy = true; controls();
  try {
    if (localStorage.getItem(pendingKey)) throw new Error('上笔交易仍待确认，请先刷新查询或在 MetaMask 处理。');
    const wei = amount(value);
    if (!settings?.configured || !account || !snapshot) throw new Error('请先连接钱包并刷新数据。');
    const chain = await window.ethereum.request({method:'eth_chainId'});
    const current = (await window.ethereum.request({method:'eth_accounts'}))[0];
    if (chain !== CHAIN_HEX || current?.toLowerCase() !== account.toLowerCase()) throw new Error('钱包账户或网络发生变化，请重新连接 Sepolia。');
    if (kind === 'withdraw' && account.toLowerCase() !== snapshot.organizer.toLowerCase()) throw new Error('只有组织者可以提款。');
    if (kind === 'withdraw' && wei > BigInt(snapshot.balance_wei)) throw new Error('提款金额超过合约余额。');
    const tx = {from:account, to:settings.contract_address,
      data:iface().encodeFunctionData(kind, kind === 'donate' ? [] : [wei]),
      value:kind === 'donate' ? ethers.toQuantity(wei) : '0x0'};
    status('tx-status', '正在校验合约请求…');
    await window.ethereum.request({method:'eth_estimateGas', params:[tx]});
    // Recheck chain immediately before handing the exact transaction to the wallet.
    if (await window.ethereum.request({method:'eth_chainId'}) !== CHAIN_HEX) throw new Error('请切换回 Sepolia。');
    status('tx-status', '请在 MetaMask 核对金额和 Gas 并确认…');
    const hash = await window.ethereum.request({method:'eth_sendTransaction', params:[tx]});
    localStorage.setItem(pendingKey, hash);
    await track(hash);
  } catch (error) { status('tx-status', errorText(error), 'error'); }
  finally { busy = false; controls(); }
}
$('clear-pending').addEventListener('click', () => {
  if (busy) return;
  if (window.confirm('请先在 Etherscan 或 MetaMask 确认这笔交易已完成或取消。停止跟踪不会取消链上交易；重复发送可能重复捐款。是否停止跟踪？')) {
    localStorage.removeItem(pendingKey); $('clear-pending').hidden = true;
    status('tx-status', '已停止本地跟踪。链上交易不受影响，请核对后再操作。');
  }
});
$('connect-button').addEventListener('click', connect);
$('donate-form').addEventListener('submit', event => { event.preventDefault(); transact('donate', $('donate-amount').value); });
$('withdraw-form').addEventListener('submit', event => { event.preventDefault(); transact('withdraw', $('withdraw-amount').value); });
$('refresh-button').addEventListener('click', async () => {
  if (busy) return;
  busy = true; controls();
  try { await refresh(); const hash = localStorage.getItem(pendingKey); if (hash) await track(hash); }
  finally { busy = false; controls(); }
});
if (window.ethereum?.on) {
  for (const name of ['accountsChanged','chainChanged']) window.ethereum.on(name, () => {
    account = null; status('wallet-status', '账户或网络已变化，请重新连接。'); controls();
  });
}
(async () => {
  try {
    settings = await api('/api/config');
    if (!settings.configured) throw new Error('合约尚未部署或配置。完成部署后即可使用。');
    $('contract-link').textContent = settings.contract_address;
    $('contract-link').href = `${EXPLORER}/address/${settings.contract_address}`;
    await refresh();
    const hash = localStorage.getItem(pendingKey);
    if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
      busy = true; controls(); await track(hash); busy = false; controls();
    }
  } catch (error) { status('data-status', errorText(error), 'error'); }
})();
