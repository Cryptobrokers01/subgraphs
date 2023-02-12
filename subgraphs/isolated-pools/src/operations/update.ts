import { Address, BigInt, Bytes, log } from '@graphprotocol/graph-ts';

import { PoolMetadataUpdatedNewMetadataStruct } from '../../generated/PoolRegistry/PoolRegistry';
import { AccountVToken, Market } from '../../generated/schema';
import { VToken } from '../../generated/templates/VToken/VToken';
import { RiskRatings, zeroBigInt32 } from '../constants';
import { exponentToBigDecimal, getExchangeRateBigDecimal } from '../utilities';
import { getTokenPriceInUsd } from '../utilities';
import { getOrCreateMarket } from './getOrCreate';
import {
  getOrCreateAccount,
  getOrCreateAccountVToken,
  getOrCreateAccountVTokenTransaction,
} from './getOrCreate';
import { getOrCreatePool } from './getOrCreate';

const updateAccountVToken = (
  marketAddress: Address,
  marketSymbol: string,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
): AccountVToken => {
  getOrCreateAccount(accountAddress);
  const accountVToken = getOrCreateAccountVToken(
    marketSymbol,
    accountAddress,
    marketAddress,
    false,
  );
  getOrCreateAccountVTokenTransaction(accountAddress, txHash, timestamp, blockNumber, logIndex);
  accountVToken.accrualBlockNumber = blockNumber;
  return accountVToken as AccountVToken;
};

export const updateAccountVTokenBorrow = (
  marketAddress: Address,
  marketSymbol: string,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
  borrowAmount: BigInt,
  accountBorrows: BigInt,
  borrowIndexMantissa: BigInt,
): AccountVToken => {
  const accountVToken = updateAccountVToken(
    marketAddress,
    marketSymbol,
    accountAddress,
    txHash,
    timestamp,
    blockNumber,
    logIndex,
  );
  accountVToken.userBorrowBalanceMantissa = accountBorrows;
  accountVToken.accountBorrowIndexMantissa = borrowIndexMantissa;
  accountVToken.save();
  return accountVToken as AccountVToken;
};

export const updateAccountVTokenRepayBorrow = (
  marketAddress: Address,
  marketSymbol: string,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
  repayAmount: BigInt,
  accountBorrows: BigInt,
  borrowIndexMantissa: BigInt,
): AccountVToken => {
  const accountVToken = updateAccountVToken(
    marketAddress,
    marketSymbol,
    accountAddress,
    txHash,
    timestamp,
    blockNumber,
    logIndex,
  );
  accountVToken.userBorrowBalanceMantissa = accountBorrows;
  accountVToken.accountBorrowIndexMantissa = borrowIndexMantissa;
  accountVToken.save();
  return accountVToken as AccountVToken;
};

export const updateAccountVTokenTransferFrom = (
  marketAddress: Address,
  marketSymbol: string,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
  amount: BigInt,
  exchangeRate: BigInt,
  underlyingDecimals: i32,
): AccountVToken => {
  const exchangeRateBigDecimal = getExchangeRateBigDecimal(exchangeRate, underlyingDecimals);
  const amountUnderlyingMantissa = exchangeRateBigDecimal
    .times(exponentToBigDecimal(underlyingDecimals))
    .times(amount.toBigDecimal());

  const accountVToken = updateAccountVToken(
    marketAddress,
    marketSymbol,
    accountAddress,
    txHash,
    timestamp,
    blockNumber,
    logIndex,
  );
  accountVToken.userSupplyBalanceMantissa = accountVToken.userSupplyBalanceMantissa.minus(amount);

  accountVToken.totalUnderlyingRedeemedMantissa =
    accountVToken.totalUnderlyingRedeemedMantissa.plus(amountUnderlyingMantissa);
  accountVToken.save();
  return accountVToken as AccountVToken;
};

export const updateAccountVTokenTransferTo = (
  marketAddress: Address,
  marketSymbol: string,
  accountAddress: Address,
  txHash: Bytes,
  timestamp: BigInt,
  blockNumber: BigInt,
  logIndex: BigInt,
  amount: BigInt,
): AccountVToken => {
  const accountVToken = updateAccountVToken(
    marketAddress,
    marketSymbol,
    accountAddress,
    txHash,
    timestamp,
    blockNumber,
    logIndex,
  );

  accountVToken.userSupplyBalanceMantissa = accountVToken.userSupplyBalanceMantissa.plus(amount);

  accountVToken.save();
  return accountVToken as AccountVToken;
};

export const updateMarket = (
  vTokenAddress: Address,
  blockNumber: i32,
  blockTimestamp: i32,
): Market => {
  const market = getOrCreateMarket(vTokenAddress);

  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber === blockNumber) {
    return market as Market;
  }
  const marketContract = VToken.bind(vTokenAddress);

  const tokenPriceUsd = getTokenPriceInUsd(
    marketContract.comptroller(),
    vTokenAddress,
    market.underlyingDecimals,
  );
  market.underlyingPriceUsd = tokenPriceUsd.truncate(market.underlyingDecimals);

  market.accrualBlockNumber = marketContract.accrualBlockNumber().toI32();
  market.blockTimestamp = blockTimestamp;

  market.exchangeRateMantissa = marketContract.exchangeRateStored();

  market.borrowIndexMantissa = marketContract.borrowIndex();

  market.reservesMantissa = marketContract.totalReserves();

  market.cash = marketContract
    .getCash()
    .toBigDecimal()
    .div(exponentToBigDecimal(market.underlyingDecimals))
    .truncate(market.underlyingDecimals);

  // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Venus Solidity
  market.borrowRateMantissa = marketContract.borrowRatePerBlock();

  // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
  // So we handle it like this.
  const supplyRatePerBlock = marketContract.try_supplyRatePerBlock();
  if (supplyRatePerBlock.reverted) {
    log.info('***CALL FAILED*** : vBEP20 supplyRatePerBlock() reverted', []);
    market.supplyRateMantissa = zeroBigInt32;
  } else {
    market.supplyRateMantissa = supplyRatePerBlock.value;
  }

  market.treasuryTotalBorrowsMantissa = marketContract.totalBorrows();
  market.treasuryTotalSupplyMantissa = marketContract.totalSupply();

  market.save();
  return market as Market;
};

export function updatePoolMetadata(
  comptroller: Address,
  newMetadata: PoolMetadataUpdatedNewMetadataStruct,
): void {
  const pool = getOrCreatePool(comptroller);
  if (pool) {
    pool.riskRating = RiskRatings[newMetadata.riskRating];
    pool.category = newMetadata.category;
    pool.logoUrl = newMetadata.logoURL;
    pool.description = newMetadata.description;
    pool.save();
  }
}
