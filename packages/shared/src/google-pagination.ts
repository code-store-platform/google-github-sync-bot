export type UserPage<A> = {
  users?: A[];
  nextPageToken?: string | null;
};

// Return only a complete snapshot. A failed/repeated page must never become a
// partial directory that the sync engine could interpret as deleted users.
export async function listAllGoogleUsers<A>(
  fetchPage: (pageToken: string | undefined) => Promise<UserPage<A>>,
): Promise<A[]> {
  const users: A[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    users.push(...(page.users ?? []));
    pageToken = page.nextPageToken || undefined;
    if (pageToken) {
      if (seen.has(pageToken)) throw new Error('Google Workspace returned a repeated page token');
      seen.add(pageToken);
    }
  } while (pageToken);
  return users;
}
