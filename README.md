# PACT

Agreements that can explain their payments.

PACT is a local workspace for freelance studios, small production teams and their clients. It turns a plain-language agreement into commitments that each point at the exact sentence they come from, and it only lets a payment exist once a named reviewer has accepted the delivered work. When someone later asks "why was this paid?", the answer is a trail: sentence, commitment, evidence, decision, payment.

## What it does

- **Cite the source.** Select words in the agreement and record a commitment against them, with an amount, a performer, a reviewer and a completion criterion.
- **Log the delivery.** Attach evidence, including the actual file. The file is fingerprinted in the browser and never uploaded; the reviewer can check their own copy against it.
- **Decide with consequences in view.** Before accepting, the reviewer sees what the decision will unlock, including dependent commitments.
- **Keep history honest.** Acceptance, dispute, revocation, amendment and deadlines are separate dated events. Readiness is recomputed from that history.
- **Pay for exactly that.** An accepted commitment can become one PayPal Sandbox order for its exact amount.

## How it uses AI

Optionally, a language model answers one kind of question: "which words in this agreement cover this?" It must return a literal passage from the agreement, which PACT locates by character position. Anything that is not an exact passage is rejected. The model never sets an amount, accepts evidence or records a decision.

Any OpenAI-compatible chat completions endpoint works. It was built and tested with `qwen2.5:7b` served by Ollama.

## How it uses PayPal

Payments use the PayPal REST API in **Sandbox** only:

- OAuth 2 client credentials, held on the server only
- Orders v2: create order for one accepted commitment
- The payer approves on PayPal's own page
- Orders v2: show order details, to read the approval and the exact amount back
- Orders v2: capture payment for order, as a separate confirmed action

A server-side journal records each request. If a provider response is lost, the state is kept as unknown and read back from PayPal; a second capture is never sent blindly.

## Run it

Requires Node.js 20 or newer. There are no npm dependencies to install.

Explore the sample agreement (no accounts needed):

```sh
node start-pact.mjs
# open http://127.0.0.1:4173
```

Run with PayPal Sandbox and a model:

```sh
export PAYPAL_SANDBOX_CLIENT_ID="your sandbox client id"
export PAYPAL_SANDBOX_CLIENT_SECRET="your sandbox client secret"
export PACT_AI_BASE_URL="http://127.0.0.1:11434/v1"
export PACT_AI_MODEL="qwen2.5:7b"
export PACT_ORDER_JOURNAL="$HOME/.pact/sandbox-orders.json"
export PORT=4173

node start-pact.mjs
```

Create Sandbox credentials at <https://developer.paypal.com/dashboard/applications/sandbox>. Keep the journal file private and back it up.

## A two-minute walkthrough

1. Open the sample agreement. Commitment 01 is **Blocked**: only a preview was delivered.
2. Choose **Add from agreement**, ask "Which words say a preview approval does not count?" and choose **Find passage**. The model highlights the exact sentence.
3. On the commitment, choose **Add evidence**, describe the delivery and attach the file.
4. In **Review delivery**, check your copy of the file, write the reason, choose **Review acceptance**, read the effect and record it.
5. Open **Payments**, choose the commitment, confirm you reviewed the clause and amount, and **Create payment request**.
6. Approve on PayPal as a Sandbox buyer, return, **Refresh payment status**, then **Capture**.

## Tests

```sh
npm test
```

## Limits

PACT is not a signature service, an escrow service or legal advice. A recorded acceptance is a local record, not a verified electronic signature. It runs on loopback and is fixed to PayPal Sandbox.

## License

MIT for PACT; see [LICENSE](LICENSE). Bundled third-party libraries under `app/vendor/` keep their own licenses. Source: <https://github.com/Jacob-Met/pact-app>

## Light and dark mode

The interface follows the system colour scheme, and the round button in the bottom-right corner switches between light and dark. The second colour sheet is generated from the first with `tools/retheme.py`, so the two always share the same layout.
