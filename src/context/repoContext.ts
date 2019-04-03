/* eslint-disable max-lines */

import { Lock } from 'lock';
import { Context } from 'probot';
import { teamConfigs, Config } from '../teamconfigs';
import { initRepoLabels, LabelResponse, Labels } from './initRepoLabels';
import { obtainTeamContext, TeamContext } from './teamContext';

interface RepoContextWithoutTeamContext {
  labels: Labels;

  hasNeedsReview: (labels: LabelResponse[]) => boolean;
  hasRequestedReview: (labels: LabelResponse[]) => boolean;
  hasApprovesReview: (labels: LabelResponse[]) => boolean;

  lockPROrPRS(
    prIdOrIds: string | string[],
    callback: () => Promise<void> | void,
  ): Promise<void>;
}

export type RepoContext<GroupNames extends string = any> = TeamContext<
  GroupNames
> &
  RepoContextWithoutTeamContext;

async function initRepoContext<GroupNames extends string>(
  context: Context<any>,
  config: Config<GroupNames>,
): Promise<RepoContext<GroupNames>> {
  const teamContext = await obtainTeamContext(context, config);
  const repoContext = Object.create(teamContext);

  const labels = await initRepoLabels(context, config);
  const reviewKeys = Object.keys(config.groups) as GroupNames[];

  const needsReviewLabelIds = reviewKeys
    .map((key) => config.labels.review[key].needsReview)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const requestedReviewLabelIds = reviewKeys
    .map((key) => config.labels.review[key].requested)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const approvedReviewLabelIds = reviewKeys
    .map((key) => config.labels.review[key].approved)
    .filter(Boolean)
    .map((name) => labels[name].id);

  // const updateStatusCheck = (context, reviewGroup, statusInfo) => {};

  const hasNeedsReview = (labels: LabelResponse[]) =>
    labels.some((label) => needsReviewLabelIds.includes(label.id));
  const hasRequestedReview = (labels: LabelResponse[]) =>
    labels.some((label) => requestedReviewLabelIds.includes(label.id));
  const hasApprovesReview = (labels: LabelResponse[]) =>
    labels.some((label) => approvedReviewLabelIds.includes(label.id));

  const lock = Lock();

  return Object.assign(repoContext, {
    labels,
    hasNeedsReview,
    hasRequestedReview,
    hasApprovesReview,

    lockPROrPRS: (prIdOrIds, callback): Promise<void> =>
      new Promise((resolve, reject) => {
        console.log('lock: try to lock pr', { prIdOrIds });
        lock(prIdOrIds, async (createReleaseCallback) => {
          const release = createReleaseCallback(() => {});
          console.log('lock: lock acquired', { prIdOrIds });
          try {
            await callback();
          } catch (err) {
            console.log('lock: release pr (with error)', { prIdOrIds });
            release();
            reject(err);
            return;
          }
          console.log('lock: release pr', { prIdOrIds });
          release();
          resolve();
        });
      }),
  } as RepoContextWithoutTeamContext);
}

const repoContextsPromise = new Map<number, Promise<RepoContext>>();
const repoContexts = new Map<number, RepoContext>();

export const obtainRepoContext = (
  context: Context<any>,
): Promise<RepoContext> | RepoContext | null => {
  const owner = context.payload.repository.owner;
  if (!teamConfigs[owner.login]) {
    console.warn(owner.login, Object.keys(teamConfigs));
    return null;
  }
  const key = context.payload.repository.id;

  const existingRepoContext = repoContexts.get(key);
  if (existingRepoContext) return existingRepoContext;

  const existingPromise = repoContextsPromise.get(key);
  if (existingPromise) return Promise.resolve(existingPromise);

  const promise = initRepoContext(context, teamConfigs[owner.login]);
  repoContextsPromise.set(key, promise);

  return promise.then((repoContext) => {
    repoContextsPromise.delete(key);
    repoContexts.set(key, repoContext);
    return repoContext;
  });
};
