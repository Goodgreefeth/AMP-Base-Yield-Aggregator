import React from "react";
import { VaultCard, StrategyCard } from "../components";

export default function Dashboard() {
  return (
    <div className="container">
      <h1>Dashboard</h1>
      {/* Wallet status, balances, and contract interactions will go here */}
      <VaultCard />
      <StrategyCard />
    </div>
  );
}
