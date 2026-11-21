import "server-only";
import { bambuFetch, type Region } from "./http";
import {
  parseDesignDetail,
  parseFeed,
  type DesignDetail,
  type Feed,
  type NavKey,
} from "../makerworld";

/**
 * MakerWorld browse / search / detail (API_NOTES.md §4). These design
 * endpoints answer without a token, but we pass one when we have it so the
 * request looks like a normal signed-in client and so detail fields that
 * depend on the viewer resolve. No access codes or tokens are ever logged.
 */

const MAX_LIMIT = 24;

export async function fetchFeed(
  region: Region,
  navKey: NavKey,
  offset: number,
  limit: number,
  token?: string,
): Promise<Feed> {
  const off = Math.max(0, Math.trunc(offset) || 0);
  const lim = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit) || MAX_LIMIT));
  const { data } = await bambuFetch(
    `/v1/search-service/select/design/nav?navKey=${encodeURIComponent(navKey)}&offset=${off}&limit=${lim}`,
    { region, token },
  );
  return parseFeed(data as Parameters<typeof parseFeed>[0]);
}

export async function searchDesigns(
  region: Region,
  keyword: string,
  offset: number,
  limit: number,
  token?: string,
): Promise<Feed> {
  const off = Math.max(0, Math.trunc(offset) || 0);
  const lim = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit) || MAX_LIMIT));
  const { data } = await bambuFetch(
    `/v1/search-service/select/design2?keyword=${encodeURIComponent(keyword)}&offset=${off}&limit=${lim}`,
    { region, token },
  );
  return parseFeed(data as Parameters<typeof parseFeed>[0]);
}

export async function fetchDesign(region: Region, designId: number, token?: string): Promise<DesignDetail | null> {
  const { data } = await bambuFetch(`/v1/design-service/design/${designId}`, { region, token });
  return parseDesignDetail(data as Parameters<typeof parseDesignDetail>[0]);
}
