# OpenClaw templates

Per-tenant agent + skill scaffolding that the bridge's `provisionTenant()`
function will fill in and drop into the OpenClaw Gateway's agents directory.

```
templates/
  agent.ecomm.yaml          ← system prompt + skill list for e-commerce tenants
  skills/
    query_orders.yaml       ← order log lookup
    top_skus.yaml           ← best-selling product ranking
    meta_ads_summary.yaml   ← Meta Ads spend + ROAS
  workspace/
    business-profile.md     ← long-form context the agent reads on every turn
```

## Placeholders

The provisioner substitutes these tokens before writing the files:

| Token                  | Source                                      |
|------------------------|---------------------------------------------|
| `${TENANT_ID}`         | slugified tenant identifier (db pk)         |
| `${TENANT_NAME}`       | customer's brand name                       |
| `${TENANT_USER}`       | the email used to address bridge endpoints  |
| `${BRIDGE_URL}`        | private VPS URL of the bridge service       |
| `${BUSINESS_DESCRIPTION}`, `${TOP_PRODUCTS}`, etc. | filled from onboarding + sync data |

## Adding a vertical

When a non-profit or dental customer signs up, the provisioner picks a
different `agent.*.yaml` template and a different set of skill files.
Recommended split:

- **e-commerce**: `query_orders`, `top_skus`, `meta_ads_summary`,
  `customer_segments`, `inventory_status`
- **non-profit**: `query_donors`, `lapsed_donors`, `grant_pipeline`,
  `campaign_roi`
- **dental**: `recall_list`, `production_summary`, `claims_aging`,
  `schedule_gaps`

Each skill is a YAML file that defines a name, description, inputs, and
the bridge endpoint it calls. The bridge endpoints follow a consistent
shape: `GET /api/data/${TENANT_USER}/<dataset>?<filter params>`.

## OpenClaw config schema

The exact YAML field names above are an educated sketch based on the
README. When you wire the first agent, check the live docs:

- Agents: https://docs.openclaw.ai/concepts/agent
- Skills: https://docs.openclaw.ai/tools/skills
- Gateway config: https://docs.openclaw.ai/gateway/configuration

Then adjust the templates to match. The placeholders and bridge endpoints
stay the same regardless of field-name differences.
