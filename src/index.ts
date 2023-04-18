/**
 * Welcome to Cloudflare Workers! This is your first scheduled worker.
 *
 * - Run `wrangler dev --local` in your terminal to start a development server
 * - Run `curl "http://localhost:8787/cdn-cgi/mf/scheduled"` to trigger the scheduled event
 * - Go back to the console to see what your worker has logged
 * - Update the Cron trigger in wrangler.toml (see https://developers.cloudflare.com/workers/wrangler/configuration/#triggers)
 * - Run `wrangler publish --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/runtime-apis/scheduled-event/
 */

import { slugify } from "@hkamran/utility-strings";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export interface Env {
    // Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
    // MY_KV_NAMESPACE: KVNamespace;
    //
    // Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
    // MY_DURABLE_OBJECT: DurableObjectNamespace;
    //
    // Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
    // MY_BUCKET: R2Bucket;

    CHECK_URL: string;
    ISSUE_LABEL: string;
    SERVICE_NAME: string;
    GITHUB_REPOSITORY: string;
    GITHUB_APP_PRIVATE_KEY: string;
    GITHUB_APP_ID: number;
    GITHUB_APP_INSTALLATION_ID: number;
    DISCORD_WEBHOOK_URL?: string;
}

export default {
    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        const [owner, repo] = env.GITHUB_REPOSITORY.split("/");

        const baseMessage = `---
section: issue
title: ${env.SERVICE_NAME} Outage
date: {isoDate}
resolved: false
draft: false
informational: false
pin: false
resolvedWhen: ""
affected:
    - ${env.SERVICE_NAME}
severity: down
---
*Investigating* - We are investigating an issue that has shut down ${env.SERVICE_NAME}. We are sorry for any inconvenience this may cause you. This incident post will be updated once we have more information. {{< track "{date}" >}}`;

        const octokit = new Octokit({
            authStrategy: createAppAuth,
            auth: {
                appId: env.GITHUB_APP_ID,
                privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
                installationId: env.GITHUB_APP_INSTALLATION_ID,
            },
            baseUrl: "https://api.github.com",
        });

        const {
            data: { slug },
        } = await octokit.rest.apps.getAuthenticated();
        console.log(slug);

        const getOnlineStatus = async (): Promise<boolean> => {
            const response = await fetch(env.CHECK_URL, {
                method: "HEAD",
                headers: { "Content-Type": "text/html;charset=UTF-8" },
            });
            return response.ok;
        };

        const getGithubIssues = async () => {
            return octokit.rest.issues.listForRepo({
                owner,
                repo,
                state: "open",
                labels: env.ISSUE_LABEL,
            });
        };

        const createIssueFile = async (): Promise<[string, string | null]> => {
            const isoString = new Date().toISOString();
            const [date, time] = isoString.split(".")[0].split("T");

            const filename = `${date}-${slugify(
                env.SERVICE_NAME,
            )}-outage-${slugify(time)}.md`;

            const create = await octokit.rest.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `content/issues/${filename}`,
                message: `Report outage for ${env.SERVICE_NAME}`,
                content: btoa(
                    baseMessage
                        .replace("{isoDate}", isoString)
                        .replace("{date}", `${date} ${time}`),
                ),
            });

            if (create.status === 201) {
                return [filename, create.data.content?.sha ?? null];
            }

            return [filename, null];
        };

        const createGithubIssue = async (
            filename: string,
            fileHash: string,
        ) => {
            return await octokit.rest.issues.create({
                owner,
                repo,
                title: `${env.SERVICE_NAME} Down`,
                body: `Automatically created by the [HTTP Monitor Bot](https://github.com/hkamran80/http-monitor-worker) at ${new Date().toISOString()}
\`\`\`json
{"filename":"${filename}","hash":"${fileHash}"}
\`\`\``,
                labels: [env.ISSUE_LABEL],
            });
        };

        const updateIssueFile = async (filename: string, fileHash: string) => {
            const currentIssueFile = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: `content/issues/${filename}`,
            });
            const currentIssueFileContent = atob(
                (currentIssueFile.data as { content: string }).content,
            );

            const isoString = new Date().toISOString();
            const [date, time] = isoString.split(".")[0].split("T");
            const updatedFile = currentIssueFileContent
                .replace("resolved: false", "resolved: true")
                .replace('resolvedWhen: ""', `resolvedWhen: ${isoString}`)
                .replace(
                    `down
---`,
                    `down
---
*Resolved* - The issue has been resolved, and ${env.SERVICE_NAME} is back online. A full postmortem will be posted soon. {{< track "${date} ${time}" >}}
`,
                );

            const update = await octokit.rest.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `content/issues/${filename}`,
                message: `Report uptime for ${env.SERVICE_NAME}`,
                content: btoa(updatedFile),
                sha: fileHash,
            });

            return update.status === 200;
        };

        const closeGithubIssue = async (issueNumber: number) => {
            const close = await octokit.rest.issues.update({
                owner,
                repo,
                issue_number: issueNumber,
                state: "closed",
            });

            return close.status === 200;
        };

        const hexToDecimal = (hex: string): number => {
            return parseInt(hex.replace("#", ""), 16);
        };

        const sendDiscordMessage = async (online: boolean) => {
            if (env.DISCORD_WEBHOOK_URL) {
                await fetch(env.DISCORD_WEBHOOK_URL, {
                    method: "POST",
                    body: JSON.stringify({
                        username: "HTTP Monitor Bot",
                        embeds: [
                            {
                                title: `${env.SERVICE_NAME} is ${
                                    online ? "Online" : "Offline"
                                }`,
                                color: hexToDecimal(
                                    online ? "#22c55e" : "#ef4444",
                                ),
                                footer: {
                                    text: "HTTP Monitor Bot, created by H. Kamran",
                                },
                            },
                        ],
                    }),
                });
            }
        };

        const issues = await getGithubIssues();
        if (issues.status === 200) {
            const isOnline = await getOnlineStatus();
            if (!isOnline && issues.data.length === 0) {
                const [filename, hash] = await createIssueFile();
                if (filename && hash) {
                    console.log("Successfully created file.");
                    const createIssue = await createGithubIssue(filename, hash);
                    if (createIssue.status === 201) {
                        console.log("Successfully created issue.");
                        sendDiscordMessage(isOnline);
                    }
                }
            } else if (isOnline && issues.data.length > 0) {
                const body = issues.data[0].body as string;
                const bodyJson = body
                    .substring(body.indexOf("```json") + 7)
                    .replace("```", "")
                    .trim();

                const issueMetadata = JSON.parse(bodyJson);
                const update = await updateIssueFile(
                    issueMetadata.filename,
                    issueMetadata.hash,
                );
                if (update) {
                    console.log("Successfully updated file.");
                    await closeGithubIssue(issues.data[0].number);
                    console.log("Successfully closed issue.");

                    sendDiscordMessage(isOnline);
                } else {
                    console.log(update);
                }
            }
        }
    },
};