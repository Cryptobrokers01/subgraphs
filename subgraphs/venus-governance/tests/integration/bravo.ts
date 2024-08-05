import { mine } from '@nomicfoundation/hardhat-network-helpers';
import '@nomiclabs/hardhat-ethers';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { ethers, network } from 'hardhat';
import { scaleValue, waitForSubgraphToBeSynced } from 'venus-subgraph-utils';

import subgraphClient from '../../subgraph-client/index';
import { SYNC_DELAY, mockAddress } from './utils/constants';

describe('GovernorBravo', function () {
  let signers: SignerWithAddress[];
  let governorBravo: Contract;
  let governorBravoDelegator: Contract;

  before(async function () {
    signers = await ethers.getSigners();
    governorBravoDelegator = await ethers.getContract('GovernorBravoDelegator');
    const governorBravoDelegateV1 = await ethers.getContract('GovernorBravoDelegateV1');
    governorBravo = await ethers.getContractAt(
      'GovernorBravoDelegateV1',
      governorBravoDelegator.address,
    );

    // Setup first governor Bravo
    await governorBravoDelegator._setImplementation(governorBravoDelegateV1.address);
    const governorAlpha2 = await ethers.getContract('GovernorAlpha2');

    // Impersonating timelock for convenience
    const timelock = await ethers.getContract('NormalTimelock');

    await signers[0].sendTransaction({
      to: timelock.address,
      value: ethers.utils.parseEther('1.0'), // Sends exactly 1.0 ether
    });

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock.address],
    });
    const timelockSigner = await ethers.getSigner(timelock.address);

    await timelock.connect(timelockSigner).setPendingAdmin(governorBravoDelegator.address);

    await governorBravo._initiate(governorAlpha2.address);

    await network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [timelock.address],
    });

    // Finished setup
    await waitForSubgraphToBeSynced(SYNC_DELAY);
  });

  describe('GovernorBravo V1', function () {
    it('should index created proposal before routes successfully', async function () {
      const [_, _1, _2, _3, user4] = signers;

      const callData = ethers.utils.defaultAbiCoder.encode(['address'], [mockAddress]);

      const vip = [
        ['0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'], // targets
        ['0'], // values
        ['setPendingAdmin(address)'], // signatures
        [callData], // params
        'Bravo Test proposal', // description
      ];

      const tx = await governorBravo.connect(user4).propose(...vip);
      await tx.wait(1);

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('22');
      expect(proposal.id).to.be.equal('22');
      expect(proposal.description).to.be.equal('Bravo Test proposal');
      expect(proposal.executionEta).to.be.null;
      expect(proposal.targets).to.deep.equal([
        '0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'.toLowerCase(),
      ]);
      expect(proposal.values).to.deep.equal(['0']);
      expect(proposal.signatures).to.deep.equal(['setPendingAdmin(address)']);
      expect(proposal.calldatas).to.deep.equal([callData]);
      expect(proposal.type).to.equal('NORMAL');
    });

    it('index for vote cast Bravo V1', async function () {
      const [_, user1, user2] = signers;

      await mine(1);

      await governorBravo.connect(user1).castVote('22', 0);
      await governorBravo.connect(user2).castVote('22', 1);

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('22');
      expect(proposal.votes.length).to.be.equal(2);

      expect(proposal.againstVotes).to.be.equal(scaleValue(700000, 18).toFixed());
      expect(proposal.forVotes).to.be.equal(scaleValue(200000, 18).toFixed());
      expect(proposal.abstainVotes).to.be.equal('0');
      expect(proposal.passing).to.be.equal(false);

      const {
        data: { delegate: delegate1 },
      } = await subgraphClient.getDelegateById(user1.address.toLowerCase());

      expect(delegate1.votes[1].id).to.equal(`${user1.address.toLowerCase()}16000000`);
      expect(delegate1.votes[1].support).to.equal('AGAINST');
      expect(delegate1.votes[1].votes).to.equal('700000000000000000000000');
      expect(delegate1.votes[1].proposal.id).to.equal('22');
      expect(delegate1.proposals.length).to.equal(1);

      const {
        data: { delegate: delegate2 },
      } = await subgraphClient.getDelegateById(user2.address.toLowerCase());
      expect(delegate2.votes[1].id).to.equal(`${user2.address.toLowerCase()}16000000`);
      expect(delegate2.votes[1].support).to.equal('FOR');
      expect(delegate2.votes[1].votes).to.equal('200000000000000000000000');
      expect(delegate2.votes[1].proposal.id).to.equal('22');
      expect(delegate2.proposals).to.deep.equal([]);
    });

    it('should index canceled proposal event', async function () {
      const [_, _1, _2, user3, user4] = signers;
      await governorBravo.connect(user3).castVote('22', 1);
      await governorBravo.connect(user4).castVote('22', 1);
      let votingPeriod = +(await governorBravo.votingPeriod());
      while (votingPeriod > 0) {
        votingPeriod--;
        await mine(1);
      }
      await governorBravo.queue(22);
      await mine(1);
      await governorBravo.connect(signers[0]).cancel('22');

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('22');

      expect(typeof proposal.canceled.blockNumber).to.equal('string');
      expect(typeof proposal.canceled.txHash).to.equal('string');
      expect(typeof proposal.canceled.timestamp).to.equal('string');
    });

    it('should index queued proposal event', async function () {
      const user4 = signers[4];
      const user3 = signers[3];
      const callData = ethers.utils.defaultAbiCoder.encode(['address'], [mockAddress]);
      const vip = [
        ['0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'], // targets
        ['0'], // values
        ['setPendingAdmin(address)'], // signatures
        [callData], // params
        'Bravo Test proposal 23', // description
      ];

      await governorBravo.connect(user4).propose(...vip);
      mine(1);
      await governorBravo.connect(user3).castVote('23', 1);
      await governorBravo.connect(user4).castVote('23', 1);

      let votingPeriod = +(await governorBravo.votingPeriod());
      while (votingPeriod > 0) {
        votingPeriod--;
        await mine(1);
      }
      await waitForSubgraphToBeSynced(SYNC_DELAY);

      await governorBravo.queue(23);

      const timelock = await ethers.getContract('NormalTimelock');
      const eta =
        (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp +
        +(await timelock.delay());

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('23');

      expect(typeof proposal.queued.blockNumber).to.equal('string');
      expect(typeof proposal.queued.txHash).to.equal('string');
      expect(typeof proposal.queued.timestamp).to.equal('string');
      expect(proposal.executionEta).to.equal(eta.toString());

      expect(proposal.againstVotes).to.be.equal('0');
      expect(proposal.forVotes).to.be.equal(scaleValue(800000, 18).toFixed());
      expect(proposal.abstainVotes).to.be.equal('0');
      expect(proposal.passing).to.be.equal(true);

      await mine(1);
      await ethers.provider.send('evm_setNextBlockTimestamp', [eta]);
    });

    it('should index succeeded proposal event', async function () {
      await governorBravo.execute('23');

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('23');

      expect(typeof proposal.executed.blockNumber).to.equal('string');
      expect(typeof proposal.executed.txHash).to.equal('string');
      expect(typeof proposal.executed.timestamp).to.equal('string');
    });
  });

  describe('GovernorBravo2', function () {
    it('should update GovernorEntity when setting implementation', async function () {
      const timelock = await ethers.getContract('NormalTimelock');
      const governorBravoDelegateV1 = await ethers.getContract('GovernorBravoDelegateV1');
      // Assert original values
      let {
        data: { governance },
      } = await subgraphClient.getGovernance();

      expect(governance.totalProposals).to.equal('4');
      expect(governance.totalDelegates).to.equal('4');
      expect(governance.totalVoters).to.equal('4');
      expect(governance.totalVotesMantissa).to.equal('1700000000000000000000000');
      expect(governance.quorumVotesMantissa).to.equal('600000000000000000000000');
      expect(governance.implementation).to.equal(governorBravoDelegateV1.address.toLowerCase());
      expect(governance.pendingAdmin).to.equal(null);
      expect(governance.admin).to.equal(signers[0].address.toLowerCase());
      expect(governance.guardian).to.equal(signers[0].address.toLowerCase());
      expect(governance.proposalMaxOperations).to.equal('10');

      const governorBravoDelegatorV2 = await ethers.getContract('GovernorBravoDelegateV2');
      const xvsVaultProxy = await ethers.getContract('XVSVaultProxy');
      const xvsVault = await ethers.getContractAt('XVSVault', xvsVaultProxy.address);

      await governorBravoDelegator._setImplementation(governorBravoDelegatorV2.address);
      governorBravo = await ethers.getContractAt('GovernorBravoDelegate', governorBravo.address);
      const minVotingDelay = await governorBravo.MIN_VOTING_DELAY();
      const minVotingPeriod = await governorBravo.MIN_VOTING_PERIOD();
      const minProposalThreshold = await governorBravo.MIN_PROPOSAL_THRESHOLD();

      const proposalConfigs = [
        {
          votingDelay: minVotingDelay,
          votingPeriod: minVotingPeriod.add(3),
          proposalThreshold: minProposalThreshold.add(1),
        },
        {
          votingDelay: minVotingDelay,
          votingPeriod: minVotingPeriod.add(2),
          proposalThreshold: minProposalThreshold.add(2),
        },
        {
          votingDelay: minVotingDelay,
          votingPeriod: minVotingPeriod.add(1),
          proposalThreshold: minProposalThreshold.add(3),
        },
      ];

      const timelocks = [timelock.address, timelock.address, timelock.address];

      await governorBravo.initialize(
        xvsVault.address,
        proposalConfigs,
        timelocks,
        signers[0].address,
      );
      await waitForSubgraphToBeSynced(SYNC_DELAY);
      // Assert updated values
      ({
        data: { governance },
      } = await subgraphClient.getGovernance());

      expect(governance.implementation).to.equal(governorBravoDelegatorV2.address.toLowerCase());
    });

    it('should index created proposal with routes successfully', async function () {
      const [_, _1, _2, _3, user4] = signers;
      const callData = ethers.utils.defaultAbiCoder.encode(['address'], [governorBravo.address]);

      const vip = [
        ['0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'], // targets
        ['0'], // values
        ['setPendingAdmin(address)'], // signatures
        [callData], // params
        'Test proposal 24', // description
        1, // route
      ];

      const tx = await governorBravo.connect(user4).propose(...vip);
      await tx.wait(1);

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('24');
      expect(proposal.id).to.be.equal('24');
      expect(proposal.description).to.be.equal('Test proposal 24');
      expect(proposal.executionEta).to.be.null;
      expect(proposal.targets).to.deep.equal([
        '0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'.toLowerCase(),
      ]);
      expect(proposal.values).to.deep.equal(['0']);
      expect(proposal.signatures).to.deep.equal(['setPendingAdmin(address)']);
      expect(proposal.calldatas).to.deep.equal([callData]);
      expect(proposal.type).to.equal('FAST_TRACK');
    });

    it('index for vote cast', async function () {
      const [_, user1, user2, user3, user4] = signers;

      await mine(1);

      await governorBravo.connect(user1).castVote('24', 0);
      await governorBravo.connect(user2).castVote('24', 2);
      await governorBravo.connect(user3).castVote('24', 1);
      await governorBravo.connect(user4).castVote('24', 1);

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('1');
      expect(proposal.votes.length).to.be.equal(4);

      expect(proposal.againstVotes).to.be.equal(scaleValue(100000, 18).toFixed());
      expect(proposal.forVotes).to.be.equal(scaleValue(1000000, 18).toFixed());
      expect(proposal.abstainVotes).to.be.equal('0');
      expect(proposal.passing).to.be.equal(true);

      const {
        data: { delegate: delegate1 },
      } = await subgraphClient.getDelegateById(user1.address.toLowerCase());

      expect(delegate1.votes[2].id).to.equal(`${user1.address.toLowerCase()}18000000`);
      expect(delegate1.votes[2].support).to.equal('AGAINST');
      expect(delegate1.votes[2].votes).to.equal('700000000000000000000000');
      expect(delegate1.votes[2].proposal.id).to.equal('24');
      expect(delegate1.proposals.length).to.equal(1);

      const {
        data: { delegate: delegate2 },
      } = await subgraphClient.getDelegateById(user2.address.toLowerCase());
      expect(delegate2.votes[2].id).to.equal(`${user2.address.toLowerCase()}18000000`);
      expect(delegate2.votes[2].support).to.equal('ABSTAIN');
      expect(delegate2.votes[2].votes).to.equal('200000000000000000000000');
      expect(delegate1.votes[2].proposal.id).to.equal('24');
      expect(delegate2.proposals.length).to.equal(0);

      const {
        data: { delegate: delegate4 },
      } = await subgraphClient.getDelegateById(user4.address.toLowerCase());
      expect(delegate4.proposals.length).to.equal(4);
    });

    it('should index canceled proposal event', async function () {
      let votingPeriod = +(await governorBravo.votingPeriod());
      while (votingPeriod > 0) {
        votingPeriod--;
        await mine(1);
      }
      await governorBravo.queue(24);
      await mine(1);
      await governorBravo.connect(signers[0]).cancel('24');

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('24');

      expect(typeof proposal.canceled.blockNumber).to.equal('string');
      expect(typeof proposal.canceled.txHash).to.equal('string');
      expect(typeof proposal.canceled.timestamp).to.equal('string');
    });

    it('should index queued proposal event', async function () {
      const user3 = signers[3];
      const user4 = signers[4];
      const callData = ethers.utils.defaultAbiCoder.encode(['address'], [mockAddress]);
      const vip = [
        ['0x939bD8d64c0A9583A7Dcea9933f7b21697ab6396'], // targets
        ['0'], // values
        ['setPendingAdmin(address)'], // signatures
        [callData], // params
        'Bravo Test proposal 25', // description
        0,
      ];

      const tx = await governorBravo.connect(user4).propose(...vip); //
      await tx.wait(1);

      await mine(1);

      await governorBravo.connect(user3).castVote('25', 1);
      await governorBravo.connect(user4).castVote('25', 1);

      await mine(1);

      let votingPeriod = +(await governorBravo.proposalConfigs(0)).votingPeriod;

      while (votingPeriod > 0) {
        votingPeriod--;
        await mine(1);
      }
      await waitForSubgraphToBeSynced(SYNC_DELAY);

      await governorBravo.queue(25);

      const governorBravoTimelock = await ethers.getContract('NormalTimelock');
      const eta =
        (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp +
        +(await governorBravoTimelock.delay());

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('25');

      expect(typeof proposal.queued.blockNumber).to.equal('string');
      expect(typeof proposal.queued.txHash).to.equal('string');
      expect(typeof proposal.queued.timestamp).to.equal('string');

      expect(proposal.executionEta).to.equal(eta.toString());

      expect(proposal.againstVotes).to.be.equal('0');
      expect(proposal.forVotes).to.be.equal(scaleValue(800000, 18).toFixed());
      expect(proposal.abstainVotes).to.be.equal('0');
      expect(proposal.passing).to.be.equal(true);

      await mine(1);
      await ethers.provider.send('evm_setNextBlockTimestamp', [eta]);
    });

    it('should index succeeded proposal event', async function () {
      await governorBravo.execute('25');

      await waitForSubgraphToBeSynced(SYNC_DELAY);

      const {
        data: { proposal },
      } = await subgraphClient.getProposalById('25');

      expect(typeof proposal.executed.blockNumber).to.equal('string');
      expect(typeof proposal.executed.txHash).to.equal('string');
      expect(typeof proposal.executed.timestamp).to.equal('string');
    });
  });
});
