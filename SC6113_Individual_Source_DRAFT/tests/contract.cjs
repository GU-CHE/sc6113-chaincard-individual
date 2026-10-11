const fs = require('node:fs');
const assert = require('node:assert/strict');
const ganache = require('ganache');
const {ethers} = require('ethers');
const {spawn} = require('node:child_process');
(async () => {
  const server = ganache.server({logging:{quiet:true},chain:{chainId:11155111,hardfork:'shanghai'},wallet:{totalAccounts:3}});
  await server.listen(18545,'127.0.0.1');
  try {
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:18545');
    const owner = await provider.getSigner(0), donor = await provider.getSigner(1);
    const artifact = JSON.parse(fs.readFileSync('static/Donation.json'));
    const c = await new ethers.ContractFactory(artifact.abi,artifact.bytecode,owner).deploy();
    await c.waitForDeployment();
    const address = await c.getAddress();
    const deployed = await c.deploymentTransaction().wait();
    const checks = [];
    assert.equal(await c.organizer(),await owner.getAddress()); checks.push('Organizer is deployer');
    await assert.rejects(c.connect(donor).donate.staticCall({value:0})); checks.push('Zero donation rejected');
    const donation = await (await c.connect(donor).donate({value:ethers.parseEther('0.01')})).wait();
    assert.equal(await c.totalDonated(),ethers.parseEther('0.01'));
    assert.equal(await c.donatedBy(await donor.getAddress()),ethers.parseEther('0.01'));
    assert.equal(c.interface.parseLog(donation.logs[0]).name,'Donated'); checks.push('Donation updates totals and emits event');
    await assert.rejects(c.connect(donor).withdraw.staticCall(1n)); checks.push('Unauthorized withdrawal rejected');
    await assert.rejects(c.withdraw.staticCall(0n)); checks.push('Zero withdrawal rejected');
    await assert.rejects(c.withdraw.staticCall(ethers.parseEther('0.02'))); checks.push('Excess withdrawal rejected');
    const withdrawal = await (await c.withdraw(ethers.parseEther('0.004'))).wait();
    assert.equal(await c.totalWithdrawn(),ethers.parseEther('0.004'));
    assert.equal(BigInt(await provider.send('eth_getBalance',[address,'latest'])),ethers.parseEther('0.006'));
    assert.equal(c.interface.parseLog(withdrawal.logs[0]).name,'Withdrawn'); checks.push('Organizer withdrawal updates balance and event');
    await assert.rejects(donor.sendTransaction({to:address,value:1n})); checks.push('Untracked direct ETH transfer rejected');
    // Real EVM reentrant recipient and transfer-failure tests.
    const solc = require('solc');
    const helper = `pragma solidity 0.8.30; import "Donation.sol";
contract Receiver { Donation public target; bool public reject; bool public reentryBlocked;
constructor(){target=new Donation();} function setReject(bool x) external {reject=x;}
function withdraw(uint x) external { target.withdraw(x); }
receive() external payable {require(!reject,"Rejected"); (bool ok,)=address(target).call(abi.encodeWithSignature("withdraw(uint256)",uint256(1))); reentryBlocked=!ok;}}
`;
    const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Donation.sol':{content:fs.readFileSync('contracts/Donation.sol','utf8')},'Receiver.sol':{content:helper}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
    const h = compiled.contracts['Receiver.sol'].Receiver;
    const receiver = await new ethers.ContractFactory(h.abi,'0x'+h.evm.bytecode.object,owner).deploy(); await receiver.waitForDeployment();
    const nested = new ethers.Contract(await receiver.getFunction('target')(),artifact.abi,donor);
    await (await nested.donate({value:100n})).wait();
    await (await receiver.withdraw(10n)).wait();
    assert.equal(await receiver.reentryBlocked(),true); checks.push('Reentrant withdrawal blocked');
    await (await receiver.setReject(true)).wait();
    await assert.rejects(receiver.withdraw.staticCall(10n));
    assert.equal(await nested.totalWithdrawn(),10n); checks.push('Rejected recipient preserves accounting');
    const result = await new Promise(resolve => {
      const child = spawn('.venv/bin/python',['-m','unittest','discover','-s','tests','-p','test_backend.py','-v'],{env:{...process.env,RPC_URL:'http://127.0.0.1:18545',CONTRACT_ADDRESS:address,DEPLOYMENT_BLOCK:String(deployed.blockNumber),TEST_DONATION_HASH:donation.hash,TEST_WITHDRAWAL_HASH:withdrawal.hash}});
      let output = '';
      child.stdout.on('data', data => output += data);
      child.stderr.on('data', data => output += data);
      child.on('close', status => { fs.writeFileSync('evidence/backend-tests.txt',output); console.log(output); resolve({status}); });
    });
    fs.writeFileSync('evidence/local-contract-tests.json',JSON.stringify({network:'LOCAL Ganache (not public Sepolia)',compiler:artifact.compiler,checks,passed:checks.length,donation:donation.hash,withdrawal:withdrawal.hash},null,2));
    console.log(JSON.stringify({contractChecksPassed:checks.length,backendStatus:result.status}));
    if (result.status !== 0) process.exitCode=1;
  } finally { await server.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
