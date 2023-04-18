# HTTP Monitor Worker

This worker is designed to monitor an HTTP service, then update [cState](https://github.com/cstate/cstate)
with the status.

## Prerequisites

- cState
- GitHub account
- Cloudflare account
- Wrangler

### Optional

- Discord webhook URL (Channel Settings > Integrations > Webhooks)
- [Healthchecks.io](https://healthchecks.io/) (self-hosted or hosted)

## Installation

1. [Create a GitHub App](https://github.com/settings/apps/new) in the GitHub account
   that owns the cState repository you will be updating

   - Name the app
   - Add a URL
   - Uncheck "Expire user authorization tokens" and the "Active" checkbox under "Webhook"
   - Enable the following repository permissions:
     - Contents: read and write
     - Issues: read and write
   - Ensure that the installation location is set to "Only on this account"

2. Next, generate a private key. You will need in a later step.
3. Generate a client secret
4. Make a note of the app ID
5. Install the app in your account by going to the "Install App" tab in the sidebar,
   then selecting your account. I recommend limiting its access to just the cState
   repositories you will be updating.
6. Go to the installed app's settings, and make a note of the installation ID

   The installation ID is in the URL:
   `https://github.com/settings/installations/[installation ID]`

7. Create a label in your cState repository for reporting outages. This will be
   used to track outages internally. Make a note of this label.
8. Clone this repository, and [install Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

   Alternatively, use `npx`/`pnpx` to use Wrangler

9. Open this repository and install the dependencies with `pnpm i`, `npm i`,
   or `yarn add`.
10. Deploy the worker with `wrangler publish`
11. Deploy all the secrets

    - `CHECK_URL`: the URL that the Worker should check returns an [OK status](https://developer.mozilla.org/en-US/docs/Web/API/Response/ok)
    - `ISSUE_LABEL`: the name of the label you created in step 7
    - `SERVICE_NAME`: the name of the service in cState (this must match)
    - `GITHUB_REPOSITORY`: the repository in the format of `user/repo`
    - `GITHUB_APP_PRIVATE_KEY`: a PKCS-8 private key on one line using `\n` as
      a delimiter
      - To convert the PKCS-1 key that GitHub generates to a PKCS-8 key, follow
        [the instructions in this README](https://github.com/gr2m/universal-github-app-jwt#readme)
    - `GITHUB_APP_ID`: the app ID you noted down in step 4
    - `GITHUB_APP_INSTALLATION_ID`: the installation ID you noted down in step 6
    - `DISCORD_WEBHOOK_URL` (optional): the Discord URL that the Worker should send
      messages to when it detects changes in the service's status
    - `HEALTHCHECKS_URL` (optional): the ping URL for Healthchecks.io
