import { Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api';
import { NotFoundError, SyncInProgressError, UpstreamError } from './errors';
import {
  ActivityPage,
  ActivityType,
  RepoDetail,
  RepoListItem,
  RepoPermission,
  RepoTeam,
  RepoWriteVisibility,
  Success,
  SyncJob,
  SyncJobRef,
  TeamDetail,
  TeamListItem,
  TeamMember,
  TeamMemberRole,
  TeamPrivacy,
  UserDetail,
  UserListItem,
  UserRepos,
  UserTeamMembership,
} from './schemas';

// Every endpoint can hit GitHub/Google, and payload/param decoding can fail
const errors = [NotFoundError, UpstreamError, HttpApiError.BadRequestNoContent] as const;

// Accepts surrounding whitespace; the BFF trims it
const NonBlankString = Schema.String.check(
  Schema.makeFilter((s: string) => s.trim().length > 0 || 'must not be blank'),
);

export class UsersGroup extends HttpApiGroup.make('users')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(UserListItem), error: errors }),
    HttpApiEndpoint.get('get', '/:email', {
      params: { email: Schema.String },
      success: UserDetail,
      error: errors,
    }),
    HttpApiEndpoint.get('teams', '/:email/teams', {
      params: { email: Schema.String },
      success: Schema.Array(UserTeamMembership),
      error: errors,
    }),
    HttpApiEndpoint.get('repos', '/:email/repos', {
      params: { email: Schema.String },
      success: UserRepos,
      error: errors,
    }),
    HttpApiEndpoint.patch('updateGitHubUsername', '/:email/github-username', {
      params: { email: Schema.String },
      payload: Schema.Struct({ githubUsername: Schema.String }),
      success: Success,
      error: errors,
    }),
  )
  .prefix('/api/users') {}

export class TeamsGroup extends HttpApiGroup.make('teams')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(TeamListItem), error: errors }),
    HttpApiEndpoint.post('create', '/', {
      payload: Schema.Struct({
        name: NonBlankString,
        description: Schema.optional(Schema.String),
        privacy: Schema.optional(TeamPrivacy),
      }),
      success: TeamDetail.pipe(HttpApiSchema.status(201)),
      error: errors,
    }),
    HttpApiEndpoint.get('get', '/:slug', {
      params: { slug: Schema.String },
      success: TeamDetail,
      error: errors,
    }),
    HttpApiEndpoint.patch('update', '/:slug', {
      params: { slug: Schema.String },
      payload: Schema.Struct({
        name: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        privacy: Schema.optional(TeamPrivacy),
      }),
      success: TeamDetail,
      error: errors,
    }),
    HttpApiEndpoint.delete('delete', '/:slug', {
      params: { slug: Schema.String },
      success: Success,
      error: errors,
    }),
    HttpApiEndpoint.get('members', '/:slug/members', {
      params: { slug: Schema.String },
      success: Schema.Array(TeamMember),
      error: errors,
    }),
    HttpApiEndpoint.post('addMember', '/:slug/members', {
      params: { slug: Schema.String },
      payload: Schema.Struct({ username: NonBlankString, role: Schema.optional(TeamMemberRole) }),
      success: Success,
      error: errors,
    }),
    HttpApiEndpoint.delete('removeMember', '/:slug/members/:username', {
      params: { slug: Schema.String, username: Schema.String },
      success: Success,
      error: errors,
    }),
  )
  .prefix('/api/teams') {}

export class ReposGroup extends HttpApiGroup.make('repos')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(RepoListItem), error: errors }),
    HttpApiEndpoint.get('get', '/:name', {
      params: { name: Schema.String },
      success: RepoDetail,
      error: errors,
    }),
    HttpApiEndpoint.patch('update', '/:name', {
      params: { name: Schema.String },
      payload: Schema.Struct({
        description: Schema.optional(Schema.String),
        homepage: Schema.optional(Schema.String),
        visibility: Schema.optional(RepoWriteVisibility),
        archived: Schema.optional(Schema.Boolean),
        topics: Schema.optional(Schema.Array(Schema.String)),
      }),
      success: RepoDetail,
      error: errors,
    }),
    HttpApiEndpoint.get('teams', '/:name/teams', {
      params: { name: Schema.String },
      success: Schema.Array(RepoTeam),
      error: errors,
    }),
    HttpApiEndpoint.put('addTeam', '/:name/teams/:teamSlug', {
      params: { name: Schema.String, teamSlug: Schema.String },
      payload: Schema.Struct({ permission: Schema.optional(RepoPermission) }),
      success: Success,
      error: errors,
    }),
    HttpApiEndpoint.delete('removeTeam', '/:name/teams/:teamSlug', {
      params: { name: Schema.String, teamSlug: Schema.String },
      success: Success,
      error: errors,
    }),
    HttpApiEndpoint.put('addCollaborator', '/:name/collaborators/:username', {
      params: { name: Schema.String, username: Schema.String },
      payload: Schema.Struct({ permission: Schema.optional(RepoPermission) }),
      success: Success,
      error: errors,
    }),
    HttpApiEndpoint.delete('removeCollaborator', '/:name/collaborators/:username', {
      params: { name: Schema.String, username: Schema.String },
      success: Success,
      error: errors,
    }),
  )
  .prefix('/api/repos') {}

export class SyncGroup extends HttpApiGroup.make('sync')
  .add(
    HttpApiEndpoint.post('triggerGitHub', '/github', {
      success: SyncJobRef.pipe(HttpApiSchema.status(202)),
      error: [...errors, SyncInProgressError],
    }),
    HttpApiEndpoint.get('job', '/jobs/:id', {
      params: { id: Schema.String },
      success: SyncJob,
      error: errors,
    }),
  )
  .prefix('/api/sync') {}

export class ActivityGroup extends HttpApiGroup.make('activity')
  .add(
    HttpApiEndpoint.get('list', '/', {
      query: {
        page: Schema.optional(Schema.Int),
        limit: Schema.optional(Schema.Int),
        type: Schema.optional(ActivityType),
      },
      success: ActivityPage,
      error: errors,
    }),
  )
  .prefix('/api/activity') {}

export class SystemGroup extends HttpApiGroup.make('system', { topLevel: true }).add(
  HttpApiEndpoint.get('health', '/health', {
    success: Schema.String.pipe(HttpApiSchema.asText()),
  }),
) {}

export class DashboardApi extends HttpApi.make('dashboard')
  .add(UsersGroup)
  .add(TeamsGroup)
  .add(ReposGroup)
  .add(SyncGroup)
  .add(ActivityGroup)
  .add(SystemGroup) {}
