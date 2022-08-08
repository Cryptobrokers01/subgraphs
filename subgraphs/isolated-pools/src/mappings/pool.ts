import { MarketEntered, MarketListed } from '../../generated/PoolRegistry/Comptroller';
import { CToken } from '../../generated/templates';
import { createMarket } from '../operations/create';
import {
  getOrCreateAccount,
  getOrCreateAccountVTokenTransaction,
  getOrCreateMarket,
} from '../operations/getOrCreate';
import { updateOrCreateAccountVToken } from '../operations/updateOrCreate';
import Box from '../utilities/box';

export const handleMarketListed = (event: MarketListed): void => {
  // Dynamically index all new listed tokens
  const cTokenAddress = event.params.cToken;
  CToken.create(cTokenAddress);
  createMarket(cTokenAddress);
};

export const handleMarketEntered = (event: MarketEntered): void => {
  const cTokenAddress = event.params.cToken;
  const accountAddress = event.params.account;

  const market = getOrCreateMarket(cTokenAddress);
  getOrCreateAccount(accountAddress);

  updateOrCreateAccountVToken(
    accountAddress,
    cTokenAddress,
    market.symbol,
    event.block.number,
    new Box(true),
  );
  getOrCreateAccountVTokenTransaction(
    accountAddress,
    event.transaction.hash,
    event.block.timestamp,
    event.block.number,
    event.logIndex,
  );
};

export const handleMarketExited = (): void => {}; // eslint-disable-line

export const handleNewCloseFactor = (): void => {}; // eslint-disable-line

export const handleNewCollateralFactor = (): void => {}; // eslint-disable-line

export const handleNewLiquidationIncentive = (): void => {}; // eslint-disable-line

export const handleNewPriceOracle = (): void => {}; // eslint-disable-line

export const handleNewPauseGuardian = (): void => {}; // eslint-disable-line

export const handleGlobalActionPaused = (): void => {}; // eslint-disable-line

export const handleMarketActionPaused = (): void => {}; // eslint-disable-line

export const handleNewBorrowCap = (): void => {}; // eslint-disable-line

export const handleNewBorrowCapGuardian = (): void => {}; // eslint-disable-line

export const handleNewMinLiquidatableAmount = (): void => {}; // eslint-disable-line
