'use client';

import { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { VideoPlayer } from '@/components/player/VideoPlayer';
import { VideoMetadata } from '@/components/player/VideoMetadata';
import { EpisodeList } from '@/components/player/EpisodeList';
import { PlayerError } from '@/components/player/PlayerError';
import { SourceSelector, SourceInfo } from '@/components/player/SourceSelector';
import { useVideoPlayer } from '@/lib/hooks/useVideoPlayer';
import { useHistory } from '@/lib/store/history-store';
import { FavoritesSidebar } from '@/components/favorites/FavoritesSidebar';
import { FavoriteButton } from '@/components/favorites/FavoriteButton';
import { PlayerNavbar } from '@/components/player/PlayerNavbar';
import { settingsStore } from '@/lib/store/settings-store';
import { premiumModeSettingsStore } from '@/lib/store/premium-mode-settings';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Image from 'next/image';

function PlayerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isPremium = searchParams.get('premium') === '1';
  const { addToHistory } = useHistory(isPremium);

  const videoId = searchParams.get('id');
  const source = searchParams.get('source');
  const title = searchParams.get('title');
  const episodeParam = searchParams.get('episode');
  const groupedSourcesParam = searchParams.get('groupedSources');

  // Track settings - use mode-specific store
  const modeStore = isPremium ? premiumModeSettingsStore : settingsStore;
  const [isReversed, setIsReversed] = useState(() =>
    typeof window !== 'undefined' ? modeStore.getSettings().episodeReverseOrder : false
  );

  // Mobile tab state
  const [activeTab, setActiveTab] = useState<'episodes' | 'info' | 'sources'>('episodes');

  // Sync with store changes if any (though usually it's one-way from UI to store)
  useEffect(() => {
    setIsReversed(modeStore.getSettings().episodeReverseOrder);
  }, []);

  // Redirect if no video ID or source
  if (!videoId || !source) {
    router.push('/');
    return null;
  }

  const {
    videoData,
    loading,
    videoError,
    currentEpisode,
    playUrl,
    setCurrentEpisode,
    setPlayUrl,
    setVideoError,
    fetchVideoDetails,
  } = useVideoPlayer(videoId, source, episodeParam, isReversed);

  // Parse grouped sources if available
  const groupedSources = useMemo<SourceInfo[]>(() => {
    let sources: SourceInfo[] = [];
    if (groupedSourcesParam) {
      try {
        sources = JSON.parse(groupedSourcesParam);
      } catch {
        sources = [];
      }
    }

    // Always ensure the current source is in the list
    if (source && !sources.find(s => s.source === source)) {
      sources.unshift({
        id: videoId || '',
        source: source,
        sourceName: source,
        pic: videoData?.vod_pic
      });
    }
    return sources;
  }, [groupedSourcesParam, source, videoId, videoData?.vod_pic]);

  // Track current source for switching
  const [currentSourceId, setCurrentSourceId] = useState(source);

  // Add initial history entry when video data is loaded
  useEffect(() => {
    if (videoData && playUrl && videoId) {
      // Map episodes to include index
      const mappedEpisodes = videoData.episodes?.map((ep, idx) => ({
        name: ep.name || `第${idx + 1}集`,
        url: ep.url,
        index: idx,
      })) || [];

      addToHistory(
        videoId,
        videoData.vod_name || title || '未知视频',
        playUrl,
        currentEpisode,
        source,
        0, // Initial playback position
        0, // Will be updated by VideoPlayer
        videoData.vod_pic,
        mappedEpisodes,
        { vod_actor: videoData.vod_actor, type_name: videoData.type_name, vod_area: videoData.vod_area }
      );
    }
  }, [videoData, playUrl, videoId, currentEpisode, source, title, addToHistory]);

  const handleEpisodeClick = useCallback((episode: any, index: number) => {
    setCurrentEpisode(index);
    setPlayUrl(episode.url);
    setVideoError('');

    // Update URL to reflect current episode
    const params = new URLSearchParams(searchParams.toString());
    params.set('episode', index.toString());
    router.replace(`/player?${params.toString()}`, { scroll: false });
  }, [searchParams, router, setCurrentEpisode, setPlayUrl, setVideoError]);

  const handleToggleReverse = (reversed: boolean) => {
    setIsReversed(reversed);
    const settings = modeStore.getSettings();
    modeStore.saveSettings({
      ...settings,
      episodeReverseOrder: reversed
    });
  };

  // Handle auto-next episode
  const handleNextEpisode = useCallback(() => {
    const episodes = videoData?.episodes;
    if (!episodes) return;

    let nextIndex;
    if (!isReversed) {
      if (currentEpisode >= episodes.length - 1) return;
      nextIndex = currentEpisode + 1;
    } else {
      if (currentEpisode <= 0) return;
      nextIndex = currentEpisode - 1;
    }

    const nextEpisode = episodes[nextIndex];
    if (nextEpisode) {
      handleEpisodeClick(nextEpisode, nextIndex); // handleEpisodeClick relies on state setters, which are stable
    }
  }, [videoData, currentEpisode, isReversed, router, searchParams]); // handleEpisodeClick is not memoized, but uses stable hooks setters. wait, handleEpisodeClick is inline too!

  return (
    <div className="min-h-screen bg-[var(--bg-color)]">
      {/* Glass Navbar */}
      <PlayerNavbar isPremium={isPremium} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-[var(--accent-color)] border-t-transparent mb-4"></div>
            <p className="text-[var(--text-color-secondary)]">正在加载视频详情...</p>
          </div>
        ) : videoError && !videoData ? (
          <PlayerError
            error={videoError}
            onBack={() => router.back()}
            onRetry={fetchVideoDetails}
          />
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Video Player Section */}
            <div className="lg:col-span-2 space-y-6">
              <VideoPlayer
                playUrl={playUrl}
                videoId={videoId || undefined}
                currentEpisode={currentEpisode}
                onBack={() => router.back()}
                totalEpisodes={videoData?.episodes?.length || 0}
                onNextEpisode={handleNextEpisode}
                isReversed={isReversed}
                isPremium={isPremium}
                videoTitle={videoData?.vod_name || title || ''}
                episodeName={videoData?.episodes?.[currentEpisode]?.name || ''}
              />
              <div className="hidden lg:block">
                <VideoMetadata
                  videoData={videoData}
                  source={source}
                  title={title}
                />
              </div>

              {/* Favorite Button for current video */}
              {videoData && videoId && (
                <div className="flex items-center gap-3 mt-4">
                  <FavoriteButton
                    videoId={videoId}
                    source={source}
                    title={videoData.vod_name || title || '未知视频'}
                    poster={videoData.vod_pic}
                    type={videoData.type_name}
                    year={videoData.vod_year}
                    size={20}
                    isPremium={isPremium}
                  />
                  <span className="text-sm text-[var(--text-color-secondary)]">
                    收藏这个视频
                  </span>
                </div>
              )}
            </div>

            {/* Sidebar with sticky wrapper */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-32 space-y-6">
                {/* Mobile Tabs */}
                {groupedSources.length > 0 && (
                  <SegmentedControl
                    options={[
                      { label: '选集', value: 'episodes' },
                      { label: '简介', value: 'info' },
                      ...(groupedSources.length > 1 ? [{ label: '来源', value: 'sources' as const }] : []),
                    ]}
                    value={activeTab}
                    onChange={setActiveTab}
                    className="lg:hidden mb-4"
                  />
                )}

                {/* Info Tab Content - Mobile Only */}
                <div className={activeTab !== 'info' ? 'hidden' : 'block lg:hidden'}>
                  <VideoMetadata
                    videoData={videoData}
                    source={source}
                    title={title}
                  />
                </div>

                {/* Episode List - Visible if desktop OR active mobile tab */}
                <div className={activeTab !== 'episodes' ? 'hidden lg:block' : 'block'}>
                  <EpisodeList
                    episodes={videoData?.episodes || null}
                    currentEpisode={currentEpisode}
                    isReversed={isReversed}
                    onEpisodeClick={handleEpisodeClick}
                    onToggleReverse={handleToggleReverse}
                  />
                </div>

                {/* Source Selector - Visible if (desktop AND grouped sources) OR (active mobile tab AND grouped sources) */}
                {groupedSources.length > 0 && (
                  <div className={activeTab !== 'sources' ? 'hidden lg:block' : 'block'}>
                    <SourceSelector
                      sources={groupedSources}
                      currentSource={currentSourceId || source || ''}
                      onSourceChange={(newSource) => {
                        // Navigate to same video with different source
                        const params = new URLSearchParams();
                        params.set('id', String(newSource.id));
                        params.set('source', newSource.source);
                        params.set('title', title || '');
                        if (groupedSourcesParam) {
                          params.set('groupedSources', groupedSourcesParam);
                        }
                        setCurrentSourceId(newSource.source);
                        router.replace(`/player?${params.toString()}`, { scroll: false });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Favorites Sidebar - Left */}
      <FavoritesSidebar isPremium={isPremium} />
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-color)]">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-[var(--accent-color)] border-t-transparent"></div>
      </div>
    }>
      <PlayerContent />
    </Suspense>
  );
}
