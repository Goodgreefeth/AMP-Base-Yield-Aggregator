import React from "react";

const backendFeatures = [
  {
    contract: "Vault.sol",
    description: "Main vault contract. Accepts deposits, tracks shares, allocates to strategies, handles withdrawals.",
    functions: ["deposit()", "withdraw()", "addStrategy()", "getUserShares()", "totalAssets()"]
  },
  {
    contract: "StrategyBase.sol",
    description: "Abstract base for all strategies. Defines standard interface for deposit, withdraw, harvest.",
    functions: ["deposit()", "withdraw()", "harvest()"]
  },
  {
    contract: "StrategyAave.sol",
    description: "Implements StrategyBase. Allocates assets to Aave for yield.",
    functions: ["deposit()", "withdraw()", "harvest()"]
  },
  {
    contract: "StrategyCompound.sol",
    description: "Implements StrategyBase. Allocates assets to Compound for yield.",
    functions: ["deposit()", "withdraw()", "harvest()"]
  },
  {
    contract: "MockERC20.sol",
    description: "Test ERC20 token for local development and testing.",
    functions: ["mint()", "transfer()", "balanceOf()"]
  }
];

export default function BackendTable() {
  return (
    <div className="container">
      <h1>Backend Contracts & Features</h1>
      <table>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Description</th>
            <th>Key Functions</th>
          </tr>
        </thead>
        <tbody>
          {backendFeatures.map((item) => (
            <tr key={item.contract}>
              <td>{item.contract}</td>
              <td>{item.description}</td>
              <td>
                <ul>
                  {item.functions.map((fn) => (
                    <li key={fn}>{fn}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
