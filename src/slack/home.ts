import type { Octokit } from '@octokit/core';
import { WebClient } from '@slack/web-api';
import type { MongoStores, Org, OrgMember } from '../mongo';
import { createLink } from './utils';

interface QueueItem {
  github: Octokit;
  slackClient: WebClient;
  member: OrgMember;
}

export const createSlackHomeWorker = (mongoStores: MongoStores) => {
  const updateMember = async (
    github: Octokit,
    slackClient: WebClient,
    member: OrgMember,
  ): Promise<void> => {
    if (!member.slack?.id) return;
    // console.log('update member', member.org.login, member.user.login);

    /* search limit: 30 requests per minute = 7 update/min max */
    const [
      prsWithRequestedReviews,
      prsToMerge,
      prsWithRequestedChanges,
      prsInDraft,
    ] = await Promise.all([
      github.search.issuesAndPullRequests({
        q: `is:pr user:${member.org.login} is:open review-requested:${member.user.login} `,
        sort: 'created',
        order: 'desc',
      }),
      github.search.issuesAndPullRequests({
        q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} label:":ok_hand: code/approved"`,
        sort: 'created',
        order: 'desc',
      }),
      github.search.issuesAndPullRequests({
        q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} label:":ok_hand: code/changes-requested"`,
        sort: 'created',
        order: 'desc',
      }),
      github.search.issuesAndPullRequests({
        q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} draft:true`,
        sort: 'created',
        order: 'desc',
        per_page: 5,
      }),
    ]);

    const blocks: any[] = [];

    const buildBlocks = (title: string, results: any) => {
      if (!results.total_count) return;

      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*`,
          },
        },
        {
          type: 'divider',
        },
        ...results.items
          .map((pr: any) => {
            const repoName = pr.repository_url.slice(
              'https://api.github.com/repos/'.length,
            );
            const prFullName = `${repoName}#${pr.number}`;

            return [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${createLink(pr.html_url, pr.title)}*`,
                  //  ${pr.labels.map((l) => `{${l.name}}`).join(' · ')}
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `${createLink(pr.html_url, prFullName)} ${
                      pr.draft ? '· _Draft_' : ''
                    }`,
                  },
                  {
                    type: 'image',
                    image_url: pr.user.avatar_url,
                    alt_text: pr.user.login,
                  },
                  {
                    type: 'mrkdwn',
                    text: `${pr.user.login}`,
                  },
                ],
              },
            ];
          })
          .flat(),
        {
          type: 'context',
          elements: [
            {
              type: 'image',
              image_url:
                'https://api.slack.com/img/blocks/bkb_template_images/placeholder.png',
              alt_text: 'placeholder',
            },
          ],
        },
      );
    };

    buildBlocks(':eyes: Requested Reviews', prsWithRequestedReviews.data);
    buildBlocks(':white_check_mark: Ready to Merge', prsToMerge.data);
    buildBlocks(':x: Changes Requested', prsWithRequestedChanges.data);
    buildBlocks(':construction: Drafts', prsInDraft.data);

    if (blocks.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ":tada: It looks like you don't have any PR to review!",
        },
      });
    }

    slackClient.views.publish({
      user_id: member.slack.id,
      view: {
        type: 'home',
        blocks,
      },
    });
  };

  let workerInterval: ReturnType<typeof setInterval> | undefined;
  const queueKeys = new Set<string>();
  const queue: QueueItem[] = [];

  const stop = (): void => {
    if (workerInterval !== undefined) {
      clearInterval(workerInterval);
      workerInterval = undefined;
    }
  };

  const start = (): void => {
    if (workerInterval !== undefined) return;
    workerInterval = setInterval(() => {
      const item = queue.shift();
      if (!item) {
        stop();
        return;
      }

      const { github, slackClient, member } = item;
      const memberId = member.slack?.id;

      const key = `${member.org.id}_${memberId}`;
      queueKeys.delete(key);

      updateMember(github, slackClient, member);
    }, 9000); // 7/min 60s 1min = 1 ttes les 8.5s max
  };

  const scheduleUpdateMember = (
    github: Octokit,
    slackClient: WebClient,
    member: OrgMember,
  ): void => {
    const memberId = member.slack?.id;
    if (!memberId) return;

    const key = `${member.org.id}_${memberId}`;

    if (!queueKeys.has(key)) {
      queueKeys.add(key);
      queue.push({
        github,
        slackClient,
        member,
      });
      start();
    }
  };

  const scheduleUpdateOrg = async (
    github: Octokit,
    org: Org,
    slackClient = new WebClient(org.slackToken),
  ): Promise<void> => {
    const cursor = await mongoStores.orgMembers.cursor();
    cursor.forEach((member) => {
      scheduleUpdateMember(github, slackClient, member);
    });
  };

  const scheduleUpdateAllOrgs = async (
    auth: (installationId: number) => Promise<Octokit>,
  ): Promise<void> => {
    const cursor = await mongoStores.orgs.cursor();
    cursor.forEach(async (org) => {
      if (!org.slackToken || !org.installationId) return;
      const github = await auth(org.installationId);
      await scheduleUpdateOrg(github, org);
    });
  };

  return {
    scheduleUpdateMember,
    scheduleUpdateOrg,
    scheduleUpdateAllOrgs,
  };
};
