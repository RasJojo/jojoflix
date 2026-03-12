import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';
import '../repository/detail_repository.dart';
import '../../home/widget/home_screen.dart';
import '../../profiles/repository/watchlist_repository.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';

part 'detail_screen.g.dart';

@riverpod
Future<MediaDetail> mediaDetail(Ref ref, String tmdbId, String mediaType) {
  return ref.watch(detailRepositoryProvider).getDetail(tmdbId, mediaType);
}

@riverpod
Future<WatchProgress?> watchProgress(Ref ref, String tmdbId, String mediaType) {
  return ref.watch(detailRepositoryProvider).getProgress(tmdbId, mediaType);
}

class DetailScreen extends ConsumerStatefulWidget {
  final String tmdbId;
  final String mediaType;

  const DetailScreen(
      {super.key, required this.tmdbId, required this.mediaType});

  @override
  ConsumerState<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends ConsumerState<DetailScreen> {
  int _selectedSeason = 0;
  bool _isWatchlistLoading = true;
  bool _isWatchlistUpdating = false;
  Set<String> _watchlistKeys = const {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadWatchlist());
  }

  @override
  void didUpdateWidget(covariant DetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.tmdbId != widget.tmdbId ||
        oldWidget.mediaType != widget.mediaType) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadWatchlist());
    }
  }

  Future<void> _loadWatchlist() async {
    final profileId = _activeProfileId;
    if (profileId == null || profileId <= 0) {
      if (!mounted) return;
      setState(() {
        _watchlistKeys = const {};
        _isWatchlistLoading = false;
      });
      return;
    }

    setState(() => _isWatchlistLoading = true);
    try {
      final items =
          await ref.read(watchlistRepositoryProvider).getWatchlist(profileId);
      if (!mounted) return;
      setState(() {
        _watchlistKeys =
            items.map((item) => '${item.mediaType}:${item.tmdbId}').toSet();
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _watchlistKeys = const {};
      });
    } finally {
      if (mounted) {
        setState(() => _isWatchlistLoading = false);
      }
    }
  }

  int? get _activeProfileId {
    final prefs = ref.read(sharedPreferencesProvider);
    return int.tryParse(prefs.getString('active_profile_id') ?? '');
  }

  bool get _isInWatchlist =>
      _watchlistKeys.contains('${widget.mediaType}:${widget.tmdbId}');

  Future<void> _toggleWatchlist() async {
    final profileId = _activeProfileId;
    if (profileId == null || profileId <= 0 || _isWatchlistUpdating) return;

    setState(() => _isWatchlistUpdating = true);
    try {
      final repo = ref.read(watchlistRepositoryProvider);
      final items = _isInWatchlist
          ? await repo.remove(profileId, widget.tmdbId, widget.mediaType)
          : await repo.add(profileId, widget.tmdbId, widget.mediaType);
      if (!mounted) return;
      setState(() {
        _watchlistKeys =
            items.map((item) => '${item.mediaType}:${item.tmdbId}').toSet();
      });
      ref.invalidate(homeRowsProvider);
    } finally {
      if (mounted) {
        setState(() => _isWatchlistUpdating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync =
        ref.watch(mediaDetailProvider(widget.tmdbId, widget.mediaType));
    final progressAsync =
        ref.watch(watchProgressProvider(widget.tmdbId, widget.mediaType));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: detailAsync.when(
        loading: () => const JojoflixLoader(),
        error: (e, _) => ErrorRetryWidget(
          message: 'Impossible de charger les détails',
          onRetry: () => ref
              .invalidate(mediaDetailProvider(widget.tmdbId, widget.mediaType)),
        ),
        data: (detail) {
          final progress = progressAsync.valueOrNull;
          return _DetailContent(
            detail: detail,
            progress: progress,
            selectedSeason: _selectedSeason,
            onSeasonChanged: (s) => setState(() => _selectedSeason = s),
            canPop: context.canPop(),
            isInWatchlist: _isInWatchlist,
            isWatchlistBusy: _isWatchlistLoading || _isWatchlistUpdating,
            onToggleWatchlist: _toggleWatchlist,
          );
        },
      ),
    );
  }
}

class _DetailContent extends StatelessWidget {
  final MediaDetail detail;
  final WatchProgress? progress;
  final int selectedSeason;
  final ValueChanged<int> onSeasonChanged;
  final bool canPop;
  final bool isInWatchlist;
  final bool isWatchlistBusy;
  final Future<void> Function() onToggleWatchlist;

  const _DetailContent({
    required this.detail,
    required this.progress,
    required this.selectedSeason,
    required this.onSeasonChanged,
    required this.canPop,
    required this.isInWatchlist,
    required this.isWatchlistBusy,
    required this.onToggleWatchlist,
  });

  String get _year {
    final date = detail.releaseDate;
    if (date == null || date.isEmpty) return '';
    return date.split('-').first;
  }

  String get _ratingLabel {
    final r = detail.rating;
    if (r == null) return '';
    return '★ ${r.toStringAsFixed(1)}';
  }

  String get _runtimeLabel {
    final rt = detail.runtime;
    if (rt == null) return '';
    final h = rt ~/ 60;
    final m = rt % 60;
    if (h > 0) return '${h}h${m.toString().padLeft(2, '0')}';
    return '${m}min';
  }

  bool get _hasProgress => (progress?.progress ?? 0) > 0;

  @override
  Widget build(BuildContext context) {
    return CustomScrollView(
      slivers: [
        // Backdrop + back button
        SliverAppBar(
          expandedHeight: 300,
          pinned: true,
          backgroundColor: AppColors.background,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () {
              if (canPop) {
                context.pop();
              } else {
                context.go('/home');
              }
            },
          ),
          flexibleSpace: FlexibleSpaceBar(
            background: Stack(
              fit: StackFit.expand,
              children: [
                if (detail.backdropUrl != null)
                  Hero(
                    tag: 'backdrop-${detail.tmdbId}',
                    child: CachedNetworkImage(
                      imageUrl: detail.backdropUrl!,
                      fit: BoxFit.cover,
                    ),
                  )
                else
                  Container(color: AppColors.surface),
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, AppColors.background],
                      stops: [0.5, 1.0],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),

        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Title
                Text(
                  detail.title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),

                // Meta row
                Row(
                  children: [
                    if (_year.isNotEmpty) ...[
                      Text(_year,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                      const SizedBox(width: AppSpacing.md),
                    ],
                    if (_ratingLabel.isNotEmpty) ...[
                      Text(_ratingLabel,
                          style: const TextStyle(
                              color: AppColors.primary, fontSize: 13)),
                      const SizedBox(width: AppSpacing.md),
                    ],
                    if (_runtimeLabel.isNotEmpty)
                      Text(_runtimeLabel,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 13)),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),

                // Progress bar (if resuming)
                if (_hasProgress) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: progress!.progress!.clamp(0.0, 1.0),
                      backgroundColor: Colors.white24,
                      color: AppColors.primary,
                      minHeight: 3,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],

                // Play / Resume button
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppSpacing.md,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(18),
                          ),
                        ),
                        icon: const Icon(Icons.play_arrow),
                        label: Text(_hasProgress ? 'Reprendre' : 'Lire'),
                        onPressed: () =>
                            _play(context, fromProgress: _hasProgress),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.textPrimary,
                        side: const BorderSide(color: AppColors.surfaceVariant),
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md,
                          vertical: AppSpacing.md,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(18),
                        ),
                      ),
                      icon: isWatchlistBusy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(
                              isInWatchlist
                                  ? Icons.bookmark
                                  : Icons.bookmark_outline,
                            ),
                      label: Text(isInWatchlist ? 'Dans ma liste' : 'Ma liste'),
                      onPressed: isWatchlistBusy ? null : onToggleWatchlist,
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),

                // Overview
                if (detail.overview != null && detail.overview!.isNotEmpty) ...[
                  Text(
                    detail.overview!,
                    style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 14,
                        height: 1.5),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],

                // Cast
                if (detail.cast.isNotEmpty) ...[
                  const Text(
                    'Casting',
                    style: TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  SizedBox(
                    height: 100,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: detail.cast.take(15).length,
                      separatorBuilder: (_, __) =>
                          const SizedBox(width: AppSpacing.sm),
                      itemBuilder: (context, i) =>
                          _CastCard(member: detail.cast[i]),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],

                // Seasons (TV only)
                if (detail.mediaType == 'tv' && detail.seasons.isNotEmpty) ...[
                  _SeasonSelector(
                    seasons: detail.seasons,
                    selectedIndex: selectedSeason,
                    onChanged: onSeasonChanged,
                  ),
                ],
              ],
            ),
          ),
        ),

        // Episode list (TV only)
        if (detail.mediaType == 'tv' && detail.seasons.isNotEmpty)
          _EpisodeList(
            season: detail.seasons[selectedSeason],
            tmdbId: detail.tmdbId,
            seriesTitle: detail.title,
            artworkUrl: detail.backdropUrl,
          ),

        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
      ],
    );
  }

  void _play(BuildContext context, {required bool fromProgress}) {
    final extra = <String, dynamic>{
      'title': detail.title,
      'artworkUrl': detail.backdropUrl,
    };
    if (fromProgress && progress != null) {
      extra['startPosition'] = progress!.currentTime ?? 0;
      if (detail.mediaType == 'tv') {
        extra['season'] = progress!.lastSeason;
        extra['episode'] = progress!.lastEpisode;
        if (progress!.lastSeason != null && progress!.lastEpisode != null) {
          extra['subtitle'] =
              'S${progress!.lastSeason} E${progress!.lastEpisode}';
        }
      }
    } else if (detail.mediaType == 'tv' && detail.seasons.isNotEmpty) {
      extra['season'] = detail.seasons.first.seasonNumber;
      extra['episode'] = detail.seasons.first.episodes.isNotEmpty
          ? detail.seasons.first.episodes.first.episodeNumber
          : 1;
      extra['subtitle'] =
          'S${detail.seasons.first.seasonNumber} E${extra['episode']}';
    }
    context.push('/player/${detail.mediaType}/${detail.tmdbId}', extra: extra);
  }
}

class _CastCard extends StatelessWidget {
  final CastMember member;
  const _CastCard({required this.member});

  @override
  Widget build(BuildContext context) {
    final personId = member.personId;
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: personId == null ? null : () => context.push('/person/$personId'),
      child: SizedBox(
        width: 88,
        child: Column(
          children: [
            CircleAvatar(
              radius: 34,
              backgroundColor: AppColors.surface,
              backgroundImage: member.profileUrl != null
                  ? CachedNetworkImageProvider(member.profileUrl!)
                  : null,
              child: member.profileUrl == null
                  ? Text(
                      member.name[0].toUpperCase(),
                      style: const TextStyle(
                          color: AppColors.textPrimary, fontSize: 22),
                    )
                  : null,
            ),
            const SizedBox(height: 6),
            Text(
              member.name,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(color: AppColors.textPrimary, fontSize: 11),
            ),
            if (member.character != null && member.character!.trim().isNotEmpty)
              Text(
                member.character!,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SeasonSelector extends StatelessWidget {
  final List<Season> seasons;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  const _SeasonSelector({
    required this.seasons,
    required this.selectedIndex,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButton<int>(
          value: selectedIndex,
          dropdownColor: AppColors.surface,
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 16),
          underline: const SizedBox(),
          items: List.generate(seasons.length, (i) {
            return DropdownMenuItem(
              value: i,
              child: Text(seasons[i].name),
            );
          }),
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ],
    );
  }
}

class _EpisodeList extends StatelessWidget {
  final Season season;
  final String tmdbId;
  final String seriesTitle;
  final String? artworkUrl;

  const _EpisodeList({
    required this.season,
    required this.tmdbId,
    required this.seriesTitle,
    this.artworkUrl,
  });

  @override
  Widget build(BuildContext context) {
    return SliverList(
      delegate: SliverChildBuilderDelegate(
        (context, i) {
          final ep = season.episodes[i];
          return _EpisodeTile(
            episode: ep,
            tmdbId: tmdbId,
            seasonNumber: season.seasonNumber,
            seriesTitle: seriesTitle,
            artworkUrl: artworkUrl,
          );
        },
        childCount: season.episodes.length,
      ),
    );
  }
}

class _EpisodeTile extends StatelessWidget {
  final Episode episode;
  final String tmdbId;
  final int seasonNumber;
  final String seriesTitle;
  final String? artworkUrl;

  const _EpisodeTile({
    required this.episode,
    required this.tmdbId,
    required this.seasonNumber,
    required this.seriesTitle,
    this.artworkUrl,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => context.push(
        '/player/tv/$tmdbId',
        extra: {
          'season': seasonNumber,
          'episode': episode.episodeNumber,
          'startPosition': episode.progress != null && episode.progress! > 0
              ? ((episode.runtime ?? 0) * 60 * episode.progress!).round()
              : 0,
          'title': seriesTitle,
          'subtitle':
              'S$seasonNumber E${episode.episodeNumber} • ${episode.name}',
          'artworkUrl': artworkUrl ?? episode.stillUrl,
        },
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
        child: Row(
          children: [
            // Still image
            ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.borderRadius),
              child: SizedBox(
                width: 120,
                height: 68,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (episode.stillUrl != null)
                      CachedNetworkImage(
                        imageUrl: episode.stillUrl!,
                        fit: BoxFit.cover,
                      )
                    else
                      Container(color: AppColors.surface),
                    if ((episode.progress ?? 0) > 0)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: LinearProgressIndicator(
                          value: episode.progress!.clamp(0.0, 1.0),
                          backgroundColor: Colors.white24,
                          color: AppColors.primary,
                          minHeight: 3,
                        ),
                      ),
                    const Center(
                      child: Icon(Icons.play_circle_outline,
                          color: Colors.white70, size: 32),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),

            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${episode.episodeNumber}. ${episode.name}',
                    style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 14,
                        fontWeight: FontWeight.w500),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (episode.overview != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      episode.overview!,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (episode.runtime != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${episode.runtime}min',
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 11),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
// Detail
// Cast
// Episodes
