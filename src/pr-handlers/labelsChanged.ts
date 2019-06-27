import Webhooks from '@octokit/webhooks';
import { Application, Context } from 'probot';
import { handlerPullRequestChange } from './utils';
import { autoMergeIfPossible } from './actions/autoMergeIfPossible';
import { updateStatusCheckFromLabels } from './actions/updateStatusCheckFromLabels';
import { updatePrBody } from './actions/updatePrBody';

export default function labelsChanged(app: Application): void {
  app.on(
    ['pull_request.labeled', 'pull_request.unlabeled'],
    async (context: Context<Webhooks.WebhookPayloadPullRequest>) => {
      const sender = context.payload.sender;
      const fromRenovate =
        sender.type === 'Bot' && sender.login === 'renovate[bot]';
      context.payload.pull_request.head.ref.startsWith('renovate/');

      if (sender.type === 'Bot' && !fromRenovate) {
        return;
      }

      await handlerPullRequestChange(context, async (repoContext) => {
        const label = (context.payload as any).label;
        if (fromRenovate) {
          const codeApprovedLabel = repoContext.labels['code/approved'];
          const autoMergeLabel = repoContext.labels['merge/automerge'];
          if (context.payload.action === 'labeled') {
            if (codeApprovedLabel && label.id === codeApprovedLabel.id) {
              // const { data: reviews } = await context.github.pulls.listReviews(
              //   context.issue({ per_page: 1 }),
              // );
              // if (reviews.length !== 0) {
              await context.github.pulls.createReview(
                context.issue({ event: 'APPROVE' }),
              );
              await updateStatusCheckFromLabels(
                context,
                repoContext,
                context.payload.pull_request,
              );
              await updatePrBody(context, repoContext, {
                autoMergeWithSkipCi: true,
              });
              // }
            } else if (autoMergeLabel && label.id === autoMergeLabel.id) {
              await updatePrBody(context, repoContext, {
                autoMerge: true,
              });
            }
            await autoMergeIfPossible(context, repoContext);
          }
          return;
        }

        if (repoContext.protectedLabelIds.includes(label.id)) {
          if (context.payload.action === 'labeled') {
            await context.github.issues.removeLabel(
              context.issue({ name: label.name }),
            );
          } else {
            await context.github.issues.addLabels(
              context.issue({ labels: [label.name] }),
            );
          }
          return;
        }

        await updateStatusCheckFromLabels(context, repoContext);

        const featureBranchLabel = repoContext.labels['feature-branch'];
        const automergeLabel = repoContext.labels['merge/automerge'];

        if (
          (featureBranchLabel && label.id === automergeLabel.id) ||
          (automergeLabel && label.id === automergeLabel.id)
        ) {
          const option: 'featureBranch' | 'autoMerge' =
            featureBranchLabel && label.id === featureBranchLabel.id
              ? 'featureBranch'
              : 'autoMerge';
          await updatePrBody(context, repoContext, {
            [option]: context.payload.action === 'labeled',
          });
        } else if (context.payload.action === 'labeled') {
          if (
            repoContext.labels['merge/automerge'] &&
            label.id === repoContext.labels['merge/automerge'].id
          ) {
            await autoMergeIfPossible(context, repoContext);
          }
        }
      });
    },
  );
}
