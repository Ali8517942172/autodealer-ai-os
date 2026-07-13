# Alba Contract Error Auditor — Walkthrough

## What this solves

Alba Cars customers have complained (Reddit, r/dubai) that registration fees on invoices don't match the official RTA receipt — e.g. AED 1,899 charged vs AED 570 actual RTA fee, with the difference billed as unexplained "handling fees."

This tool lets a customer upload their contract/invoice **before paying**, and instantly see if the registration fee matches the official rate.

## How it works

1. **Customer uploads** a photo or PDF of their contract on the web page (`apps/contract-auditor/index.html`)
2. The file is sent to an **n8n webhook** (`/webhook/contract-audit`)
3. n8n encodes the file and sends it to **OpenRouter's free vision model** (`google/gemma-4-31b-it:free`) with a prompt to extract every line item and the registration fee
4. A Code node compares the extracted registration fee against the **official UAE RTA fee (AED 570)**
5. The result — itemized fees, and a clear flag if there's a discrepancy — is returned to the page instantly

## Demo script (for pitching to Alba Cars)

1. Open the web page
2. Upload a sample contract image with an inflated registration fee (e.g. AED 1,899)
3. Show the result: "⚠️ AED 1,329 above the official RTA registration fee was found in unexplained charges"
4. Pitch line: *"This isn't an accusation — it's a trust tool. Customers who see transparent pricing upfront convert faster and complain less. This catches pricing errors before they become bad reviews."*

## Current setup (demo/free stage)

- **n8n**: running locally via Docker, exposed through a Tailscale Funnel URL — free, but requires the host laptop to stay on
- **Vision AI**: OpenRouter free-tier model — no cost, but rate-limited and the specific free model can change
- **Frontend**: plain HTML/JS, deployable free on Vercel

## Known limitations (be upfront about these before going to production)

- Free OpenRouter models can be rate-limited or swapped out — for a paying client, budget ~$5–10/month for a paid vision model as a reliable fallback
- n8n only stays reachable while the host machine, Docker, and the Tailscale tunnel are all running — for production, migrate to a permanently-hosted n8n (Oracle Cloud Free Tier VM, or paid n8n Cloud)
- The official RTA fee (AED 570) is currently hardcoded — confirm this is still the correct government rate before using with real customers, and consider making it configurable per emirate/vehicle type
- The AI extraction can misread poor-quality photos — always show the raw extracted line items alongside the verdict so the customer can sanity-check it themselves

## Files in this solution

- `apps/contract-auditor/index.html` — customer-facing upload page
- n8n workflow: "Alba Contract Error Auditor - Transparency Agent" (workflow ID `25DDrhmAmxMp7JiD`)
