import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bracketDocument } from '../data/demos';
import {
  GuidePublishError,
  buildPublishedLink,
  fetchPublishedGuide,
  fetchPublishedGuides,
  fetchWorkshopNetworkInfo,
  formatGuideSize,
  pickLanApiBase,
  publishGuide,
  readPublishedLink,
  type WorkshopNetworkInfo,
} from './publishedGuides';

const LAN = 'http://192.168.1.50:8000';
const document = JSON.parse(JSON.stringify(bracketDocument)) as unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(async (input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

const networkInfo: WorkshopNetworkInfo = {
  status: 'ok',
  hostname: 'shop-pc',
  primary: '192.168.1.50',
  primaryIsLan: true,
  addresses: [
    { ip: '127.0.0.1', kind: 'loopback', primary: false },
    { ip: '192.168.1.50', kind: 'lan', primary: true },
  ],
  guidePort: 8000,
  suggestedApiBase: LAN,
  studioAvailable: true,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('published-guide links', () => {
  it('packs the code and the api address into a short shop-floor link', () => {
    const link = buildPublishedLink('http://192.168.1.50:8000/', 'pay88sbx');
    expect(link).toBe(`http://192.168.1.50:8000/?guideId=pay88sbx&api=http%3A%2F%2F192.168.1.50%3A8000`);
    // Short enough for a tiny, easy-to-scan code.
    expect(link.length).toBeLessThan(120);
  });

  it('degrades to the app deep link when no server address is known', () => {
    expect(buildPublishedLink('', 'pay88sbx')).toBe('ikguide://guide/pay88sbx');
    expect(buildPublishedLink('localhost:8000', 'pay88sbx')).toBe('ikguide://guide/pay88sbx');
  });

  it('reads the code and api from a location, a hash route, a raw link and a bare code', () => {
    expect(readPublishedLink({ search: '?guideId=pay88sbx&api=http%3A%2F%2F192.168.1.50%3A8000' })).toEqual({
      guideId: 'pay88sbx',
      api: LAN,
    });
    expect(readPublishedLink({ search: '', hash: '#/?guideId=pay88sbx' })).toEqual({ guideId: 'pay88sbx', api: null });
    expect(readPublishedLink(`http://192.168.1.50:8000/?guideId=pay88sbx&api=${encodeURIComponent(LAN)}`)).toEqual({
      guideId: 'pay88sbx',
      api: LAN,
    });
    expect(readPublishedLink('ikguide://guide/pay88sbx')).toEqual({ guideId: 'pay88sbx', api: null });
    expect(readPublishedLink('pay88sbx')).toEqual({ guideId: 'pay88sbx', api: null });
  });

  it('still understands the stage-4 `?guide=` route and ignores junk', () => {
    expect(readPublishedLink({ search: '?guide=demo-up08-3d' })).toEqual({ guideId: 'demo-up08-3d', api: null });
    expect(readPublishedLink({ search: '?g=abcdef' })).toBeNull();
    expect(readPublishedLink(null)).toBeNull();
    expect(readPublishedLink('мама мыла раму')).toBeNull();
    expect(readPublishedLink({ search: '?guideId=плохой код' })).toBeNull();
  });
});

describe('publishing to the workshop server', () => {
  it('posts the whole document and returns the short code', async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe(`${LAN}/v1/guides`);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as { id: string; steps: unknown[] };
      expect(body.id).toBe(bracketDocument.id);
      expect(body.steps).toHaveLength(bracketDocument.steps.length);
      return jsonResponse(
        {
          id: 'pub12345',
          guideId: 'pub12345',
          title: 'Кронштейн',
          drawingCode: 'ИК-01.02',
          revision: 'Б',
          createdAt: '2026-11-26T09:00:00Z',
          sizeBytes: 4096,
          has3d: true,
          steps: 4,
          url: '/v1/guides/pub12345',
          absoluteUrl: `${LAN}/v1/guides/pub12345`,
          deduplicated: false,
        },
        201,
      );
    });

    const result = await publishGuide(bracketDocument, { baseUrl: LAN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'pub12345', guideId: 'pub12345', has3d: true, deduplicated: false });
  });

  it('recognises a re-publish of the same instruction: same code, no second file', async () => {
    stubFetch(() => jsonResponse({ id: 'pub12345', title: 'Кронштейн', deduplicated: true }, 201));
    const result = await publishGuide(bracketDocument, { baseUrl: LAN });
    expect(result.deduplicated).toBe(true);
    expect(result.id).toBe('pub12345');
  });

  it('explains a 64 MB refusal instead of dumping a status code', async () => {
    stubFetch(() => jsonResponse({ detail: 'too big' }, 413));
    await expect(publishGuide(bracketDocument, { baseUrl: LAN })).rejects.toMatchObject({
      kind: 'too-large',
    });
    await expect(publishGuide(bracketDocument, { baseUrl: LAN })).rejects.toThrow(/64 МБ/);
  });

  it('surfaces the server explanation for an invalid document', async () => {
    stubFetch(() => jsonResponse({ detail: 'Нет шагов в инструкции' }, 422));
    await expect(publishGuide(bracketDocument, { baseUrl: LAN })).rejects.toMatchObject({
      kind: 'rejected',
      message: 'Нет шагов в инструкции',
    });
  });

  it('says the workshop server is unreachable when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = await publishGuide(bracketDocument, { baseUrl: LAN }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuidePublishError);
    expect((error as GuidePublishError).kind).toBe('offline');
    expect((error as GuidePublishError).message).toContain(LAN);
  });
});

describe('downloading a published guide', () => {
  it('gets the document by code and validates it against the shared schema', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toBe(`${LAN}/v1/guides/pub12345`);
      return jsonResponse(document);
    });
    const doc = await fetchPublishedGuide('pub12345', { baseUrl: LAN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(doc.id).toBe(bracketDocument.id);
    expect(doc.steps).toHaveLength(bracketDocument.steps.length);
  });

  it('hides a hostile code inside the path but keeps it readable in the message', async () => {
    stubFetch(() => jsonResponse({ detail: 'not found' }, 404));
    await expect(fetchPublishedGuide('../../etc/passwd', { baseUrl: LAN })).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('rejects a document from the server that does not match the schema', async () => {
    stubFetch(() => jsonResponse({ schemaVersion: '1.0.0', id: 'x' }));
    await expect(fetchPublishedGuide('pub12345', { baseUrl: LAN })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('lists the newest publications without their heavy bodies', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toBe(`${LAN}/v1/guides?limit=3`);
      return jsonResponse({
        count: 2,
        guides: [
          { id: 'aaa111', title: 'Кронштейн', sizeBytes: 2048, steps: 4, has3d: true, createdAt: '2026-11-26T09:00:00Z' },
          { id: 'bbb222', title: '', sizeBytes: 'нет' },
          { nope: true },
        ],
      });
    });
    const guides = await fetchPublishedGuides({ baseUrl: LAN, limit: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(guides.map((guide) => guide.id)).toEqual(['aaa111', 'bbb222']);
    expect(guides[0]!.has3d).toBe(true);
    expect(guides[1]!.title).toBe('Без названия');
    expect(guides[1]!.sizeBytes).toBe(0);
  });

  it('returns null instead of throwing when the address book is unavailable', async () => {
    stubFetch(() => jsonResponse({}, 500));
    expect(await fetchWorkshopNetworkInfo({ baseUrl: LAN })).toBeNull();
  });
});

describe('workshop address book', () => {
  it('parses what the server says about itself', async () => {
    stubFetch(() => jsonResponse(networkInfo));
    const info = await fetchWorkshopNetworkInfo({ baseUrl: LAN });
    expect(info).toMatchObject({ primary: '192.168.1.50', primaryIsLan: true, guidePort: 8000, studioAvailable: true });
    expect(info?.addresses).toHaveLength(2);
  });

  it('prefers a real LAN address over loopback and falls back to the suggestion', () => {
    expect(pickLanApiBase(networkInfo)).toBe(LAN);
    expect(
      pickLanApiBase({
        ...networkInfo,
        primary: '127.0.0.1',
        primaryIsLan: false,
        addresses: [{ ip: '127.0.0.1', kind: 'loopback', primary: true }],
        suggestedApiBase: '',
      }),
    ).toBeNull();
    expect(
      pickLanApiBase({
        ...networkInfo,
        primaryIsLan: false,
        addresses: [],
        suggestedApiBase: 'http://10.0.0.7:8000',
      }),
    ).toBe('http://10.0.0.7:8000');
    expect(pickLanApiBase(null)).toBeNull();
  });

  it('uses the LAN address even when the server picked a link-local one as primary', () => {
    expect(
      pickLanApiBase({
        ...networkInfo,
        primary: '169.254.0.21',
        primaryIsLan: false,
        addresses: [
          { ip: '169.254.0.21', kind: 'link-local', primary: true },
          { ip: '192.168.1.50', kind: 'lan', primary: false },
        ],
      }),
    ).toBe(LAN);
  });

  it('prints file sizes the way the engineer expects', () => {
    expect(formatGuideSize(0)).toBe('—');
    expect(formatGuideSize(900)).toBe('900 Б');
    expect(formatGuideSize(2048)).toBe('2.0 КБ');
    expect(formatGuideSize(1024 * 1024 * 2.4)).toBe('2.4 МБ');
  });
});
