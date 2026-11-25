import { describe, test } from 'node:test';
import { strict as assert } from 'assert';
import { providerOf, providersOf, remoteHost } from '../providers';

describe('providers', () => {
  test('the host is read from every form of remote address; local paths have none', () => {
    const cases: [string, string | undefined, string | undefined][] = [
      ['https://github.com/o/r.git', 'github.com', 'github'],
      ['git@github.com:o/r.git', 'github.com', 'github'],
      ['ssh://git@gitlab.example.com:2222/g/r.git', 'gitlab.example.com', 'gitlab'],
      ['https://user:token@bitbucket.org/o/r.git', 'bitbucket.org', 'bitbucket'],
      ['https://GITEA.my.lan:3000/o/r', 'gitea.my.lan', 'gitea'],
      ['codeberg.org:o/r.git', 'codeberg.org', 'codeberg'],
      ['https://git.example.com/github/r.git', 'git.example.com', undefined],
      ['https://github:gitlab@example.com/r', 'example.com', undefined],
      ['C:\\repos\\github\\r', undefined, undefined],
      ['../gitlab/r.git', undefined, undefined],
      ['/srv/git/github.git', undefined, undefined],
      ['file:///srv/gitlab.git', undefined, undefined],
      ['', undefined, undefined],
    ];
    for (const [url, host, provider] of cases) {
      assert.equal(remoteHost(url), host, url);
      assert.equal(providerOf(url), provider, url);
    }
  });

  test('by remote name, only known ones, and nothing of the address itself', () => {
    const got = providersOf([
      { name: 'origin', fetchUrl: 'https://user:secret@github.com/o/r.git' },
      { name: 'mirror', pushUrl: 'git@gitlab.com:o/r.git' },
      { name: 'local', fetchUrl: '/srv/r.git' },
    ]);
    assert.deepEqual(got, { origin: 'github', mirror: 'gitlab' });
    assert.doesNotMatch(JSON.stringify(got), /secret/);
  });
});
