import React from "react";

export default function Docs() {
  return (
    <div className="container">
      <h1>Docs & FAQ</h1>
      <p>How BaseEarn works, security, audits, and frequently asked questions.</p>
      <section style={{marginTop: 32}}>
        <h2>Protocol Fees & Treasury</h2>
        <p>
          BaseEarn charges a small protocol fee (configurable, up to 5%) on yield withdrawals and rebalancing. All fees are sent directly to the protocol treasury, which is visible on-chain. This supports ongoing development, security, and ecosystem growth. You can track all fee events and the total fees collected for full transparency.
        </p>
        <ul>
          <li><b>Fee Rate:</b> Set by governance, never above 5%.</li>
          <li><b>Treasury Address:</b> Public and auditable on-chain.</li>
          <li><b>Events:</b> Every fee is logged with a FeeCollected event.</li>
          <li><b>Total Fees:</b> Cumulative totalFeesCollected is available on-chain.</li>
        </ul>
      </section>
    </div>
  );
}
