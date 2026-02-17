/**
 * usePersonalizedRecommendations
 *
 * Fetches personalized content based on viewing history patterns.
 * Designed to integrate into the tag system — returns the same shape
 * as usePopularMovies (movies, loading, hasMore, prefetchRef, loadMoreRef).
 *
 * Features:
 * - Interleaves results from multiple recommendation queries into a single mixed feed
 * - Randomizes Douban API offsets so each page load shows different content
 * - Excludes already-watched titles
 * - Auto-infinite-scroll via useInfiniteScroll (no "load more" button)
 * - Caches results for 30 minutes
 * - hasHistory = true when viewingHistory.length >= 2
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useHistoryStore, usePremiumHistoryStore } from '@/lib/store/history-store';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import {
  generateRecommendations,
  getWatchedTitles,
  interleaveResults,
  type RecommendationQuery,
} from '@/lib/utils/recommendation-engine';

interface DoubanMovie {
  id: string;
  title: string;
  cover: string;
  rate: string;
  url: string;
}

interface InterleavedMovie extends DoubanMovie {
  sourceLabel: string;
}

const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const ITEMS_PER_PAGE = 18; // How many to fetch per query per page

export function usePersonalizedRecommendations(isPremium = false) {
  const normalHistory = useHistoryStore();
  const premiumHistory = usePremiumHistoryStore();
  const { viewingHistory } = isPremium ? premiumHistory : normalHistory;

  const [movies, setMovies] = useState<InterleavedMovie[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const queriesRef = useRef<RecommendationQuery[]>([]);
  const cacheRef = useRef<{
    key: string;
    movies: InterleavedMovie[];
    timestamp: number;
  } | null>(null);

  const hasHistory = viewingHistory.length >= 2;

  // Fetch a page of results from all queries
  const fetchPage = useCallback(async (
    queries: RecommendationQuery[],
    pageNum: number,
    watchedTitles: Set<string>,
  ): Promise<InterleavedMovie[]> => {
    const results = await Promise.all(
      queries.map(async (query) => {
        try {
          const offset = query.pageStart + pageNum * ITEMS_PER_PAGE;
          const res = await fetch(
            `/api/douban/recommend?tag=${encodeURIComponent(query.tag)}&type=${query.type}&page_limit=${ITEMS_PER_PAGE}&page_start=${offset}`
          );
          if (!res.ok) return { label: query.label, movies: [] as DoubanMovie[] };
          const data = await res.json();
          const movies: DoubanMovie[] = (data.subjects || []).map((s: any) => ({
            id: s.id,
            title: s.title,
            cover: s.cover,
            rate: s.rate,
            url: s.url,
          }));
          return { label: query.label, movies };
        } catch {
          return { label: query.label, movies: [] as DoubanMovie[] };
        }
      })
    );

    return interleaveResults(results, watchedTitles);
  }, []);

  // Initial load
  useEffect(() => {
    if (viewingHistory.length < 2) {
      setMovies([]);
      setHasMore(false);
      return;
    }

    const queries = generateRecommendations(viewingHistory);
    queriesRef.current = queries;

    if (queries.length === 0) {
      setMovies([]);
      setHasMore(false);
      return;
    }

    // Cache key based on query tags (not pageStart, since that's randomized)
    const cacheKey = queries.map(q => `${q.tag}:${q.type}`).join('|');

    if (
      cacheRef.current &&
      cacheRef.current.key === cacheKey &&
      Date.now() - cacheRef.current.timestamp < CACHE_DURATION
    ) {
      setMovies(cacheRef.current.movies);
      setHasMore(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPage(0);
    setHasMore(true);

    const watchedTitles = getWatchedTitles(viewingHistory);

    fetchPage(queries, 0, watchedTitles).then((interleaved) => {
      if (cancelled) return;
      setMovies(interleaved);
      setHasMore(interleaved.length >= queries.length * 2);
      cacheRef.current = {
        key: cacheKey,
        movies: interleaved,
        timestamp: Date.now(),
      };
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [viewingHistory.length, fetchPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load more via infinite scroll
  const handleLoadMore = useCallback(async (nextPage: number) => {
    const queries = queriesRef.current;
    if (queries.length === 0 || loading) return;

    setLoading(true);
    const watchedTitles = getWatchedTitles(viewingHistory);

    try {
      const newMovies = await fetchPage(queries, nextPage, watchedTitles);

      // Deduplicate against existing movies
      const existingTitles = new Set(movies.map(m => m.title.toLowerCase().trim()));
      const uniqueNew = newMovies.filter(
        m => !existingTitles.has(m.title.toLowerCase().trim())
      );

      if (uniqueNew.length === 0) {
        setHasMore(false);
      } else {
        setMovies((prev) => [...prev, ...uniqueNew]);
        setPage(nextPage);
        // Update cache
        if (cacheRef.current) {
          cacheRef.current.movies = [...cacheRef.current.movies, ...uniqueNew];
        }
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [loading, viewingHistory, movies, fetchPage]);

  const { prefetchRef, loadMoreRef } = useInfiniteScroll({
    hasMore,
    loading,
    page,
    onLoadMore: handleLoadMore,
  });

  return { movies, loading, hasMore, hasHistory, prefetchRef, loadMoreRef };
}
