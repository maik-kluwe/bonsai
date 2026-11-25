/**
 * Which service a remote lives on, told by its host name alone (no network): the view shows that service's mark instead
 * of the cloud. Only the key goes to the view; the address stays here, as it may carry a password or a token.
 */
export type Provider = 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'codeberg';

/** Part of a host name -> service, so that self-hosted servers such as gitlab.example.com count. */
const NAMES: Provider[] = ['github', 'gitlab', 'bitbucket', 'gitea', 'codeberg'];

/** The host of a Git remote address: a URL, or the short form `user@host:path`. Undefined for local paths. */
export function remoteHost(url: string): string | undefined {
  if (url.includes('://')) {
    try { return new URL(url).hostname.toLowerCase() || undefined; } catch { return undefined; }
  }
  // A single letter before the colon is a Windows drive, and a slash before it makes it a path
  return /^(?:[^@/\\]+@)?([^/\\:]{2,}):/.exec(url)?.[1].toLowerCase();
}

export function providerOf(url: string | undefined): Provider | undefined {
  const host = url ? remoteHost(url) : undefined;
  return host ? NAMES.find(name => host.includes(name)) : undefined;
}

/** The services of the remotes, by remote name; remotes of unknown services are left out. */
export function providersOf(remotes: readonly { name: string; fetchUrl?: string; pushUrl?: string }[]): Record<string, Provider> {
  return Object.fromEntries(remotes.flatMap(r => {
    const provider = providerOf(r.fetchUrl ?? r.pushUrl);
    return provider ? [[r.name, provider]] : [];
  }));
}
