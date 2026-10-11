const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {ethers} = require('ethers');
const checks = [];
const elements = new Map();
const element = () => ({hidden:false,disabled:false,value:'',textContent:'',className:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},replaceChildren(){},append(){}});
const settings = {configured:true,contract_address:'0x'+'a'.repeat(40),abi:JSON.parse(fs.readFileSync('static/Donation.json')).abi};
const wallet = '0x'+'b'.repeat(40), owner = '0x'+'c'.repeat(40), hash = '0x'+'d'.repeat(64);
const data = {organizer:owner,total_donated_wei:'1',total_withdrawn_wei:'0',balance_wei:'1',transactions:[],history_from_block:1,latest_block:2};
const storage = new Map();
let reject = false, chain = '0xaa36a7', sendCount = 0;
const context = vm.createContext({ethers,console,AbortSignal,setTimeout,document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async path=>({ok:true,json:async()=>path==='/api/config'?settings:path==='/api/dashboard'?data:{status:'success'}}),window:{confirm:()=>true,ethereum:{on(){},request:async ({method})=>{
  if (reject) throw Object.assign(new Error('rejected'),{code:4001});
  if(method==='eth_requestAccounts'||method==='eth_accounts')return [wallet];
  if(method==='eth_chainId')return chain;
  if(method==='wallet_switchEthereumChain'){chain='0xaa36a7';return;}
  if(method==='eth_estimateGas')return '0x10000';
  if(method==='eth_sendTransaction'){sendCount++;return hash;}
}}}});
vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
(async()=>{
  await new Promise(resolve=>setTimeout(resolve,10));
  for(const value of ['0','-1','1e-3','NaN','0.0000000000000000001']) assert.throws(()=>vm.runInContext(`amount(${JSON.stringify(value)})`,context));
  assert.equal(vm.runInContext("amount('0.000000000000000001')",context),1n); checks.push('Invalid and zero amounts rejected; one wei preserved exactly');
  reject=true; await vm.runInContext('connect()',context);
  assert.match(elements.get('wallet-status').textContent,/取消/);assert.equal(sendCount,0);checks.push('Wallet rejection shown without sending');
  reject=false;chain='0x1';await vm.runInContext('connect()',context);assert.equal(chain,'0xaa36a7');checks.push('Wallet switches to Sepolia');
  chain='0x1';await vm.runInContext("transact('donate','0.001')",context);assert.equal(sendCount,0);checks.push('Wrong network blocks submission');
  chain='0xaa36a7';await vm.runInContext("transact('withdraw','0.000000000000000001')",context);assert.equal(sendCount,0);checks.push('Non-organizer withdrawal blocked in UI');
  await vm.runInContext("transact('donate','0.001')",context);assert.equal(sendCount,1);assert.match(elements.get('tx-status').textContent,/成功/);assert.equal(storage.size,0);checks.push('Donation submits once and shows confirmed receipt');
  fs.writeFileSync('evidence/frontend-tests.json',JSON.stringify({type:'Simulated DOM, wallet and API; not a real MetaMask test',passed:checks.length,checks},null,2));
  console.log(checks.join('\n'));
})().catch(error=>{console.error(error);process.exitCode=1;});
