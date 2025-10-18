import React from "react";
import { WalletConnect } from "../components";

export default function Home() {
  return (
    <div className="container">
      <header>
        <h1>BaseEarn — Build your base, grow your yield.</h1>
        <p>Deposit, earn, and manage your yield strategies on Base.</p>
        <WalletConnect />
      </header>
      <section>
        <h2>How it works</h2>
        <ol>
          <li>Connect wallet</li>
          <li>Deposit assets</li>
          <li>Earn aggregated yields</li>
        </ol>
      </section>
      <section style={{marginTop: 32, background: '#f8f8f8', padding: 16, borderRadius: 8}}>
        <h3>Protocol Fees & Transparency</h3>
        <p>
          A small protocol fee (configurable, max 5%) is collected on yield withdrawals and rebalancing. All fees are sent directly to the protocol treasury for ongoing maintenance, security, and development. You can view all fee events and cumulative totals on-chain for full transparency.
        </p>
      </section>
      <footer>
        <a href="/docs">Docs</a> | <a href="/about">About</a> | <a href="https://github.com/">GitHub</a> | <a href="https://twitter.com/">Twitter</a>
        <p>DeFi is risky. DYOR.</p>
      </footer>
    </div>
  );
}
