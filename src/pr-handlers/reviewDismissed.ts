import { Application } from 'probot';
import { createHandlerPullRequestChange } from './utils';
import { updateReviewStatus } from './actions/updateReviewStatus';

export default (app: Application) => {
  app.on(
    'pull_request_review.dismissed',
    createHandlerPullRequestChange(async (context, repoContext) => {
      const sender = context.payload.sender;
      const pr = context.payload.pull_request;
      const reviewer = (context.payload as any).review.user;

      const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

      if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
        const { data: reviews } = await context.github.pulls.listReviews(
          context.issue({ per_page: 50 }),
        );
        const hasChangesRequestedInReviews = reviews.some(
          (review) =>
            repoContext.getReviewerGroup(review.user.login) === reviewerGroup &&
            review.state === 'REQUEST_CHANGES',
        );

        await updateReviewStatus(context, repoContext, reviewerGroup, {
          add: ['needsReview', 'requested'],
          remove: [
            !hasChangesRequestedInReviews && 'changesRequested',
            'approved',
          ],
        });
      }

      if (repoContext.slack) {
        if (sender.login === reviewer.login) {
          repoContext.slack.postMessage(
            pr.user.login,
            `:skull: ${repoContext.slack.mention(
              reviewer.login,
            )} dismissed his review on ${pr.html_url}`,
          );
        } else {
          repoContext.slack.postMessage(
            reviewer.login,
            `:skull: ${repoContext.slack.mention(
              sender.login,
            )} dismissed your review on ${pr.html_url}`,
          );
        }
      }
    }),
  );
};
