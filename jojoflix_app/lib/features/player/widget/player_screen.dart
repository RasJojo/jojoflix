import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../../../core/native/native_playback_bridge.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';
import '../../../core/network/api_client.dart';
import '../provider/video_player_provider.dart';
import '../repository/source_repository.dart';
import '../repository/subtitle_repository.dart';
import '../repository/transcode_repository.dart';

class PlayerScreen extends ConsumerStatefulWidget {
  final String tmdbId;
  final String mediaType;
  final int profileId;
  final int? season;
  final int? episode;
  final int startPosition;
  final String? title;
  final String? subtitle;
  final String? artworkUrl;

  const PlayerScreen({
    super.key,
    required this.tmdbId,
    required this.mediaType,
    required this.profileId,
    this.season,
    this.episode,
    this.startPosition = 0,
    this.title,
    this.subtitle,
    this.artworkUrl,
  });

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen> {
  final NativePlaybackBridge _nativePlaybackBridge =
      NativePlaybackBridge.instance;
  bool _isBootstrapping = true;
  bool _slowProvidersLoaded = false;
  bool _isLoadingSources = false;
  bool _isLoadingSubtitles = false;
  bool _isSwitchingSource = false;
  bool _isApplyingTrackChange = false;
  bool _isInPictureInPicture = false;
  String? _fatalError;

  List<TorrentSource> _sources = const [];
  List<SubtitleEntry> _openSubtitles = const [];
  List<MediaMarker> _markers = const [];

  String? _activeSourceKey;
  String _activeAudioTrackLabel = 'Auto';
  String _subtitleSelectionKey = 'off';
  String _subtitleSelectionLabel = 'Désactivés';
  static const int _autoNextDelaySeconds = 8;
  Timer? _autoNextTimer;
  int _autoNextRemainingSeconds = _autoNextDelaySeconds;
  bool _autoNextCancelled = false;
  bool _skipIntroHandled = false;

  @override
  void initState() {
    super.initState();
    _isInPictureInPicture =
        _nativePlaybackBridge.pictureInPictureNotifier.value;
    _nativePlaybackBridge.pictureInPictureNotifier
        .addListener(_handlePictureInPictureChanged);
    unawaited(_nativePlaybackBridge.setPictureInPictureEnabled(true));
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncNativeMetadata());
  }

  @override
  void dispose() {
    _nativePlaybackBridge.pictureInPictureNotifier
        .removeListener(_handlePictureInPictureChanged);
    unawaited(_nativePlaybackBridge.setPictureInPictureEnabled(false));
    _stopAutoNextTimer(
      resetCountdown: false,
      resetCancellation: false,
    );
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant PlayerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final metadataChanged = oldWidget.title != widget.title ||
        oldWidget.subtitle != widget.subtitle ||
        oldWidget.artworkUrl != widget.artworkUrl;
    final shouldReload = oldWidget.tmdbId != widget.tmdbId ||
        oldWidget.mediaType != widget.mediaType ||
        oldWidget.profileId != widget.profileId ||
        oldWidget.season != widget.season ||
        oldWidget.episode != widget.episode ||
        oldWidget.startPosition != widget.startPosition;
    if (!shouldReload) {
      if (metadataChanged) {
        WidgetsBinding.instance
            .addPostFrameCallback((_) => _syncNativeMetadata());
      }
      return;
    }

    if (mounted) {
      setState(() {
        _sources = const [];
        _openSubtitles = const [];
        _markers = const [];
        _activeSourceKey = null;
        _fatalError = null;
        _subtitleSelectionKey = 'off';
        _subtitleSelectionLabel = 'Désactivés';
        _skipIntroHandled = false;
      });
    }
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_bootstrap());
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncNativeMetadata());
  }

  void _handlePictureInPictureChanged() {
    if (!mounted) return;
    setState(() {
      _isInPictureInPicture =
          _nativePlaybackBridge.pictureInPictureNotifier.value;
    });
  }

  void _syncNativeMetadata() {
    final notifier = ref.read(videoPlayerNotifierProvider.notifier);
    final fallbackTitle =
        widget.mediaType == 'tv' ? 'Lecture série' : 'Lecture film';
    final title = (widget.title?.trim().isNotEmpty ?? false)
        ? widget.title!.trim()
        : fallbackTitle;
    final subtitle = (widget.subtitle?.trim().isNotEmpty ?? false)
        ? widget.subtitle!.trim()
        : (widget.mediaType == 'tv' &&
                widget.season != null &&
                widget.episode != null)
            ? 'S${widget.season} E${widget.episode}'
            : null;

    unawaited(
      notifier.setPresentationMetadata(
        title: title,
        subtitle: subtitle,
        artworkUrl: widget.artworkUrl,
      ),
    );
  }

  Future<void> _bootstrap() async {
    if (mounted) {
      setState(() {
        _isBootstrapping = true;
        _fatalError = null;
        _skipIntroHandled = false;
      });
    }
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);

    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    try {
      await _restorePreferredSource();
      var streamStarted = false;
      try {
        // Démarrage optimiste: on lance le stream immédiatement
        // pour réduire le délai entre épisodes.
        await playerNotifier.loadStream(
          tmdbId: widget.tmdbId,
          mediaType: widget.mediaType,
          profileId: widget.profileId,
          season: widget.season,
          episode: widget.episode,
          startPosition: widget.startPosition,
          sourceKey: _activeSourceKey,
        );
        streamStarted = true;
      } catch (_) {
        streamStarted = false;
      }

      if (!streamStarted) {
        await _loadSources(
          showErrorSnackBar: false,
          includeSlowProviders: false,
        );
        if (_sources.isEmpty) {
          if (!mounted) return;
          setState(() {
            _fatalError =
                'Aucune source disponible pour ce contenu. Essaie un autre épisode/source.';
          });
          return;
        }
        final selectedSourceKey =
            await _selectBestPlayableSource(preferredKey: _activeSourceKey);
        if (!mounted) return;
        if (selectedSourceKey != null &&
            selectedSourceKey != _activeSourceKey) {
          setState(() {
            _activeSourceKey = selectedSourceKey;
          });
        }

        final persistedKey = await _startNativePlayback(
          playerNotifier,
          sourceKey: selectedSourceKey ?? _activeSourceKey,
        );
        if (persistedKey != null && persistedKey.isNotEmpty) {
          await _persistPreferredSourceKey(persistedKey);
        }
      } else {
        unawaited(
          _loadSources(showErrorSnackBar: false, includeSlowProviders: false),
        );
      }

      unawaited(_prewarmNextEpisode(preferredSourceKey: _activeSourceKey));

      await _loadMarkers();
      await _loadOpenSubtitles(showErrorSnackBar: false);
      _syncTrackSelections();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _fatalError = 'Impossible de charger le lecteur.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isBootstrapping = false;
        });
      }
    }
  }

  Future<void> _loadSources({
    bool showErrorSnackBar = true,
    bool includeSlowProviders = false,
  }) async {
    if (mounted) {
      setState(() {
        _isLoadingSources = true;
      });
    }

    try {
      final repo = ref.read(sourceRepositoryProvider);
      final sources = widget.mediaType == 'tv'
          ? await repo.getTvSources(
              widget.tmdbId,
              widget.season ?? 1,
              widget.episode ?? 1,
              includeSlowProviders: includeSlowProviders,
            )
          : await repo.getMovieSources(
              widget.tmdbId,
              includeSlowProviders: includeSlowProviders,
            );

      if (!mounted) return;
      setState(() {
        _sources = sources;
        if (includeSlowProviders) _slowProvidersLoaded = true;
        final hasCurrent = _activeSourceKey != null &&
            sources.any((s) => s.key == _activeSourceKey);
        if (!hasCurrent) {
          _activeSourceKey = sources.isNotEmpty ? sources.first.key : null;
        }
      });
    } catch (_) {
      if (!mounted || !showErrorSnackBar) return;
      _showErrorSnackBar('Impossible de charger les sources.');
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingSources = false;
        });
      }
    }
  }

  Future<void> _loadOpenSubtitles({bool showErrorSnackBar = true}) async {
    if (mounted) {
      setState(() {
        _isLoadingSubtitles = true;
      });
    }

    try {
      final repo = ref.read(subtitleRepositoryProvider);
      final items = await repo.listSubtitles(
        widget.tmdbId,
        season: widget.season,
        episode: widget.episode,
      );
      items.sort((a, b) {
        final byPriority = _subtitleLanguageRank(a.language) -
            _subtitleLanguageRank(b.language);
        if (byPriority != 0) return byPriority;
        final byReleaseMatch =
            _subtitleReleaseMatchScore(b) - _subtitleReleaseMatchScore(a);
        if (byReleaseMatch != 0) return byReleaseMatch;
        if (a.hearingImpaired != b.hearingImpaired) {
          return a.hearingImpaired ? 1 : -1;
        }
        final byLanguage = a.language.compareTo(b.language);
        if (byLanguage != 0) return byLanguage;
        return a.releaseName.compareTo(b.releaseName);
      });

      if (!mounted) return;
      setState(() {
        _openSubtitles = items;
      });
    } catch (_) {
      if (!mounted || !showErrorSnackBar) return;
      _showErrorSnackBar(
          'Impossible de charger les sous-titres OpenSubtitles Pro.');
    } finally {
      if (mounted) {
        setState(() {
          _isLoadingSubtitles = false;
        });
      }
    }
  }

  Future<void> _loadMarkers() async {
    try {
      final repo = ref.read(subtitleRepositoryProvider);
      final markers = await repo.getMarkers(widget.tmdbId);
      final sanitized = markers
          .where((marker) =>
              (marker.type == 'intro' || marker.type == 'outro') &&
              marker.endTime > marker.startTime)
          .toList(growable: false);
      if (!mounted) return;
      setState(() {
        _markers = sanitized;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _markers = const [];
      });
    }
  }

  MediaMarker? _markerByType(String type) {
    for (final marker in _markers) {
      if (marker.type == type && marker.endTime > marker.startTime) {
        return marker;
      }
    }
    return null;
  }

  bool _isPositionInsideMarker(MediaMarker marker, Duration position) {
    final second = position.inSeconds;
    return second >= marker.startTime && second < marker.endTime;
  }

  MediaMarker? _activeIntroMarker(Duration position) {
    final intro = _markerByType('intro');
    if (intro == null || _skipIntroHandled) return null;
    if (_isPositionInsideMarker(intro, position)) return intro;
    return null;
  }

  bool _shouldOfferAutoNext(VideoPlayerState playerState) {
    if (!_canGoToNextEpisode) return false;
    if (playerState.isLoading || !playerState.isPlaying) return false;

    final outro = _markerByType('outro');
    if (outro != null) {
      return _isPositionInsideMarker(outro, playerState.position);
    }
    return playerState.nearEnd;
  }

  void _onPlaybackStateChanged(VideoPlayerState playerState) {
    final intro = _markerByType('intro');
    if (intro != null &&
        _skipIntroHandled &&
        playerState.position.inSeconds < intro.startTime) {
      setState(() {
        _skipIntroHandled = false;
      });
    }

    final shouldOffer = _shouldOfferAutoNext(playerState);
    if (!shouldOffer) {
      if (_autoNextTimer != null || _autoNextCancelled) {
        setState(() {
          _stopAutoNextTimer(
            resetCountdown: true,
            resetCancellation: true,
          );
        });
      }
      return;
    }

    if (_autoNextCancelled || _autoNextTimer != null) return;

    setState(() {
      _autoNextRemainingSeconds = _autoNextDelaySeconds;
    });
    _autoNextTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final currentState = ref.read(videoPlayerNotifierProvider);
      if (!_shouldOfferAutoNext(currentState)) {
        setState(() {
          _stopAutoNextTimer(
            resetCountdown: true,
            resetCancellation: true,
          );
        });
        return;
      }
      if (_autoNextRemainingSeconds <= 1) {
        timer.cancel();
        setState(() {
          _stopAutoNextTimer(
            resetCountdown: true,
            resetCancellation: true,
          );
        });
        unawaited(_goToNextEpisode());
        return;
      }
      setState(() {
        _autoNextRemainingSeconds -= 1;
      });
    });
  }

  void _stopAutoNextTimer({
    bool resetCountdown = false,
    bool resetCancellation = false,
  }) {
    _autoNextTimer?.cancel();
    _autoNextTimer = null;
    if (resetCountdown) {
      _autoNextRemainingSeconds = _autoNextDelaySeconds;
    }
    if (resetCancellation) {
      _autoNextCancelled = false;
    }
  }

  Future<void> _skipIntro(MediaMarker marker) async {
    await ref
        .read(videoPlayerNotifierProvider.notifier)
        .skipToSecond(marker.endTime);
    if (!mounted) return;
    setState(() {
      _skipIntroHandled = true;
    });
  }

  void _cancelAutoNextForCurrentEpisode() {
    if (!mounted) return;
    setState(() {
      _autoNextCancelled = true;
      _stopAutoNextTimer(resetCountdown: true, resetCancellation: false);
    });
  }

  Future<String?> _selectBestPlayableSource({String? preferredKey}) async {
    final ordered = _orderedSourceCandidates(preferredKey);
    if (ordered.isEmpty) return null;

    final isApple = _isApplePlatform;
    final totalBudget =
        isApple ? const Duration(seconds: 8) : const Duration(seconds: 5);
    final maxSourcesToProbe = isApple ? 6 : 4;
    final deadline = DateTime.now().add(totalBudget);
    String? likelyAvailableKey;

    for (final source in ordered.take(maxSourcesToProbe)) {
      if (likelyAvailableKey == null && source.hasDirectUrl) {
        likelyAvailableKey = source.key;
      }
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) break;

      final maxProbeTimeout =
          isApple ? const Duration(seconds: 3) : const Duration(seconds: 2);
      final probeTimeout =
          remaining > maxProbeTimeout ? maxProbeTimeout : remaining;
      final probe = await _probeSourceAvailability(
        source.key,
        timeout: probeTimeout,
      );
      if (probe.ok) return probe.selectedSourceKey ?? source.key;
    }

    if (likelyAvailableKey != null) return likelyAvailableKey;
    return ordered.first.key;
  }

  List<TorrentSource> _orderedSourceCandidates(String? preferredKey) {
    if (_sources.isEmpty) return const [];
    final preferred = (preferredKey == null || preferredKey.isEmpty)
        ? <TorrentSource>[]
        : _sources.where((s) => s.key == preferredKey).toList();
    final others = _sources.where((s) => s.key != preferredKey).toList();

    if (_isApplePlatform) {
      others.sort((a, b) {
        final prefRankDelta =
            (a.preferenceRank ?? 99).compareTo(b.preferenceRank ?? 99);
        if (prefRankDelta != 0) return prefRankDelta;

        final sourceLanguageDelta =
            _sourceLanguageRank(a).compareTo(_sourceLanguageRank(b));
        if (sourceLanguageDelta != 0) return sourceLanguageDelta;

        final byStability = _nativeStabilityScore(b) - _nativeStabilityScore(a);
        if (byStability != 0) return byStability;

        final aSize = a.sizeGb ?? double.infinity;
        final bSize = b.sizeGb ?? double.infinity;
        if (aSize != bSize) return aSize.compareTo(bSize);

        return b.score - a.score;
      });
    }

    return [...preferred, ...others];
  }

  bool get _isApplePlatform =>
      defaultTargetPlatform == TargetPlatform.iOS ||
      defaultTargetPlatform == TargetPlatform.macOS;

  int _sourceLanguageRank(TorrentSource source) {
    final text = '${source.name} ${source.tags.join(' ')}'.toLowerCase();

    if (RegExp(r'\b(truefrench|vff|vfq)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 0;
    }
    if (RegExp(r'\b(french|français|francais|vf)\b', caseSensitive: false)
            .hasMatch(text) &&
        !RegExp(r'\b(vostfr|subfrench|vost|rus|russian|italian|german|spanish)\b',
                caseSensitive: false)
            .hasMatch(text)) {
      return 1;
    }
    if (RegExp(r'\b(vostfr|subfrench|vost)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 2;
    }
    if (RegExp(r'\b(english|anglais|eng)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 3;
    }
    if (RegExp(r'\b(japanese|japonais|jpn)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 4;
    }
    if (RegExp(r'\b(korean|coreen|coréen|kor)\b', caseSensitive: false)
        .hasMatch(text)) {
      return 5;
    }
    if (RegExp(r'\b(rus|russian|italian|german|spanish)\b',
            caseSensitive: false)
        .hasMatch(text)) {
      return 20;
    }
    return 10;
  }

  int _nativeStabilityScore(TorrentSource source) {
    final text = '${source.name} ${source.tags.join(' ')}'.toLowerCase();
    var score = 0;

    if (source.hasDirectUrl) score += 10;
    if ((source.cachedRank ?? 0) >= 2 ||
        text.contains('cached') ||
        text.contains('⚡')) {
      score += 7;
    }

    final resolution = source.resolution.toLowerCase();
    if (resolution == '720p') score += 5;
    if (resolution == '1080p') score += 4;
    if (resolution == '480p') score += 3;
    if (resolution == '4k' || resolution == '2160p') score -= 4;

    final size = source.sizeGb;
    if (size != null) {
      if (size <= 2.0) {
        score += 4;
      } else if (size <= 4.0) {
        score += 3;
      } else if (size <= 8.0) {
        score += 1;
      } else if (size >= 12.0) {
        score -= 4;
      }
    }

    return score;
  }

  Future<_SourceProbeResult> _probeSourceAvailability(
    String sourceKey, {
    Duration timeout = const Duration(seconds: 2),
  }) async {
    try {
      final dio = ref.read(apiClientProvider).dio;
      final path = _streamPath();
      final response = await dio.get<List<int>>(
        path,
        queryParameters: {'source_key': sourceKey},
        options: Options(
          responseType: ResponseType.bytes,
          sendTimeout: timeout,
          receiveTimeout: timeout,
          headers: const {'Range': 'bytes=0-1024'},
        ),
      );
      final code = response.statusCode ?? 0;
      if (code < 200 || code >= 300) {
        return const _SourceProbeResult(ok: false);
      }
      return _SourceProbeResult(
        ok: true,
        selectedSourceKey:
            response.headers.value('x-jojoflix-selected-source-key'),
      );
    } on DioException {
      return const _SourceProbeResult(ok: false);
    } catch (_) {
      return const _SourceProbeResult(ok: false);
    }
  }

  String _streamPath() {
    if (widget.mediaType == 'tv' &&
        widget.season != null &&
        widget.episode != null) {
      return '/api/stream/tv/${widget.tmdbId}/s/${widget.season}/e/${widget.episode}';
    }
    return '/api/stream/movie/${widget.tmdbId}';
  }

  void _syncTrackSelections() {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final activeAudio = playerNotifier.activeAudioTrack;
    final activeEmbeddedSubtitle = playerNotifier.activeEmbeddedSubtitleTrack;

    if (!mounted) return;
    setState(() {
      _activeAudioTrackLabel = activeAudio?.label ?? 'Auto';
      if (playerNotifier.isExternalSubtitleTrackSelected) {
        if (!_subtitleSelectionKey.startsWith('open:')) {
          _subtitleSelectionKey = 'external';
          _subtitleSelectionLabel = 'Sous-titre externe';
        }
      } else if (activeEmbeddedSubtitle != null) {
        _subtitleSelectionKey = 'embedded:${activeEmbeddedSubtitle.id}';
        _subtitleSelectionLabel = '${activeEmbeddedSubtitle.label} (intégré)';
      } else {
        _subtitleSelectionKey = 'off';
        _subtitleSelectionLabel = 'Désactivés';
      }
    });
  }

  Future<void> _seekBackward15() async {
    await ref.read(videoPlayerNotifierProvider.notifier).seekBackward();
  }

  Future<void> _seekForward15() async {
    await ref.read(videoPlayerNotifierProvider.notifier).seekForward();
  }

  int _subtitleLanguageRank(String language) {
    final normalized = language.toLowerCase().trim();
    if (normalized == 'fr' ||
        normalized.startsWith('fr-') ||
        normalized == 'french') {
      return 0;
    }
    if (normalized == 'en' ||
        normalized.startsWith('en-') ||
        normalized == 'english') {
      return 1;
    }
    if (normalized == 'ja' ||
        normalized.startsWith('ja-') ||
        normalized == 'japanese') {
      return 2;
    }
    if (normalized == 'ko' ||
        normalized.startsWith('ko-') ||
        normalized == 'korean') {
      return 3;
    }
    return 10;
  }

  bool get _canGoToPreviousEpisode =>
      widget.mediaType == 'tv' &&
      widget.season != null &&
      widget.episode != null &&
      widget.episode! > 1;

  bool get _canGoToNextEpisode =>
      widget.mediaType == 'tv' &&
      widget.season != null &&
      widget.episode != null;

  Future<void> _goToPreviousEpisode() async {
    if (!_canGoToPreviousEpisode) return;
    await _goToEpisode(widget.episode! - 1);
  }

  Future<void> _goToNextEpisode() async {
    if (!_canGoToNextEpisode) return;
    await _goToEpisode(widget.episode! + 1);
  }

  Future<void> _goToEpisode(int episodeNumber) async {
    if (!mounted || widget.mediaType != 'tv' || widget.season == null) return;
    _stopAutoNextTimer(resetCountdown: true, resetCancellation: true);
    final location = Uri(
      path: '/player/${widget.mediaType}/${widget.tmdbId}',
      queryParameters: {
        'profileId': widget.profileId.toString(),
        'season': widget.season!.toString(),
        'episode': episodeNumber.toString(),
        'startPosition': '0',
      },
    ).toString();
    context.go(location);
  }

  Future<void> _openSourceSelector() async {
    if (_sources.isEmpty || !_slowProvidersLoaded) {
      await _loadSources(includeSlowProviders: true);
    }
    if (!mounted) return;

    final selected = await showModalBottomSheet<TorrentSource>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) {
        return _SelectorSheet(
          title: 'Sources (${_sources.length})',
          child: _sources.isEmpty
              ? const Center(
                  child: Text(
                    'Aucune source disponible',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              : ListView.separated(
                  itemCount: _sources.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final source = _sources[index];
                    final isSelected = source.key == _activeSourceKey;
                    final tags = source.tags.isEmpty
                        ? ''
                        : ' • ${source.tags.join(' / ')}';
                    return ListTile(
                      selected: isSelected,
                      selectedColor: AppColors.textPrimary,
                      selectedTileColor: AppColors.surfaceVariant,
                      leading: Icon(
                        source.magnet.isNotEmpty ? Icons.download : Icons.link,
                        color: AppColors.textSecondary,
                      ),
                      title: Text(
                        source.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textPrimary),
                      ),
                      subtitle: Text(
                        '${source.providerLabel} • ${source.resolution} • ${source.sizeLabel} • score ${source.score}$tags',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: AppColors.textSecondary),
                      ),
                      trailing: isSelected
                          ? const Icon(Icons.check_circle,
                              color: AppColors.primary)
                          : null,
                      onTap: () => Navigator.of(context).pop(source),
                    );
                  },
                ),
        );
      },
    );

    if (selected == null || selected.key == _activeSourceKey) return;

    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    if (mounted) {
      setState(() {
        _isSwitchingSource = true;
      });
    }

    try {
      await playerNotifier.switchSource(selected.key);
      if (!mounted) return;
      setState(() {
        _activeSourceKey = selected.key;
        _subtitleSelectionKey = 'off';
        _subtitleSelectionLabel = 'Désactivés';
      });
      await _persistPreferredSourceKey(selected.key);
      unawaited(_prewarmNextEpisode(preferredSourceKey: selected.key));
      _syncTrackSelections();
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer de source.');
    } finally {
      if (mounted) {
        setState(() {
          _isSwitchingSource = false;
        });
      }
    }
  }

  Future<void> _openAudioSelector() async {
    final dataFuture = _loadAudioSelectionData();

    final selectedTrack = await showModalBottomSheet<PlayerTrack>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) {
        return _SelectorSheet(
          title: 'Pistes audio',
          child: FutureBuilder<_AudioSelectionData>(
            future: dataFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(
                  child: CircularProgressIndicator(color: AppColors.primary),
                );
              }

              if (snapshot.hasError || !snapshot.hasData) {
                return const Center(
                  child: Text(
                    'Impossible de charger les pistes audio',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                );
              }

              final data = snapshot.data!;
              final tracks = data.tracks;
              final activeAudio = data.activeTrack;
              final enrichedLabels = data.labelsByTrackId;

              if (tracks.isEmpty) {
                return const Center(
                  child: Text(
                    'Aucune piste audio détectée',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                );
              }

              return ListView.separated(
                itemCount: tracks.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final track = tracks[index];
                  final trackLabel = enrichedLabels[track.id] ?? track.label;
                  final isSelected =
                      activeAudio != null && activeAudio.id == track.id;
                  return ListTile(
                    title: Text(
                      trackLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textPrimary),
                    ),
                    trailing: isSelected
                        ? const Icon(Icons.check_circle,
                            color: AppColors.primary)
                        : null,
                    onTap: () => Navigator.of(context).pop(track),
                  );
                },
              );
            },
          ),
        );
      },
    );

    if (selectedTrack == null) return;

    if (mounted) {
      setState(() {
        _isApplyingTrackChange = true;
      });
    }

    try {
      final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
      await _applyAudioTrackChange(playerNotifier, selectedTrack);
      if (!mounted) return;
      _syncTrackSelections();
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer la piste audio.');
    } finally {
      if (mounted) {
        setState(() {
          _isApplyingTrackChange = false;
        });
      }
    }
  }

  Future<_AudioSelectionData> _loadAudioSelectionData() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final tracks = await playerNotifier.getAudioTracks();
    final activeAudio = playerNotifier.activeAudioTrack;
    final labelsByTrackId = await _resolveAudioLabels(tracks);
    return _AudioSelectionData(
      tracks: tracks,
      activeTrack: activeAudio,
      labelsByTrackId: labelsByTrackId,
    );
  }

  String _preferredSourceStorageKey() {
    final season = widget.season ?? 0;
    return 'preferred_source:${widget.profileId}:${widget.mediaType}:${widget.tmdbId}:s$season';
  }

  Future<void> _restorePreferredSource() async {
    if (_activeSourceKey != null && _activeSourceKey!.isNotEmpty) return;
    final prefs = ref.read(sharedPreferencesProvider);
    final saved = prefs.getString(_preferredSourceStorageKey());
    if (saved == null || saved.isEmpty) return;
    _activeSourceKey = saved;
  }

  Future<void> _persistPreferredSourceKey(String sourceKey) async {
    if (sourceKey.isEmpty) return;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setString(_preferredSourceStorageKey(), sourceKey);
  }

  Future<void> _prewarmNextEpisode({String? preferredSourceKey}) async {
    if (widget.mediaType != 'tv' ||
        widget.season == null ||
        widget.episode == null) {
      return;
    }

    try {
      await ref.read(sourceRepositoryProvider).prewarmNextEpisode(
            widget.tmdbId,
            widget.season!,
            widget.episode! + 1,
            sourceKey: preferredSourceKey,
          );
    } catch (_) {
      // Best-effort: ne doit jamais bloquer le playback courant.
    }
  }

  Future<void> _openSubtitleSelector() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final embeddedTracks = playerNotifier.subtitleTracks;

    final choice = await showModalBottomSheet<_SubtitleChoice>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) {
        return _SelectorSheet(
          title: 'Sous-titres',
          child: ListView(
            children: [
              ListTile(
                title: const Text(
                  'Désactiver les sous-titres',
                  style: TextStyle(color: AppColors.textPrimary),
                ),
                trailing: _subtitleSelectionKey == 'off'
                    ? const Icon(Icons.check_circle, color: AppColors.primary)
                    : null,
                onTap: () =>
                    Navigator.of(context).pop(const _SubtitleChoice.disable()),
              ),
              const Divider(height: 1),
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Text(
                  'Pistes intégrées',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (embeddedTracks.isEmpty)
                const ListTile(
                  title: Text(
                    'Aucun sous-titre intégré détecté',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              else
                ...embeddedTracks.map((track) {
                  final key = 'embedded:${track.id}';
                  return ListTile(
                    title: Text(
                      track.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.textPrimary),
                    ),
                    trailing: _subtitleSelectionKey == key
                        ? const Icon(Icons.check_circle,
                            color: AppColors.primary)
                        : null,
                    onTap: () => Navigator.of(context).pop(
                      _SubtitleChoice.embedded(track),
                    ),
                  );
                }),
              const Divider(height: 1),
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Text(
                  'OpenSubtitles Pro',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              if (_isLoadingSubtitles)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                      child:
                          CircularProgressIndicator(color: AppColors.primary)),
                )
              else if (_openSubtitles.isEmpty)
                const ListTile(
                  title: Text(
                    'Aucun sous-titre OpenSubtitles disponible',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                )
              else
                ..._openSubtitles.map((entry) {
                  final key = _openSubtitleSelectionKey(entry);
                  return ListTile(
                    title: Text(
                      entry.displayName,
                      style: const TextStyle(color: AppColors.textPrimary),
                    ),
                    subtitle: entry.releaseName.isNotEmpty
                        ? Text(
                            entry.releaseName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style:
                                const TextStyle(color: AppColors.textSecondary),
                          )
                        : null,
                    trailing: _subtitleSelectionKey == key
                        ? const Icon(Icons.check_circle,
                            color: AppColors.primary)
                        : null,
                    onTap: () => Navigator.of(context).pop(
                      _SubtitleChoice.openSubtitle(entry),
                    ),
                  );
                }),
            ],
          ),
        );
      },
    );

    if (choice == null) return;

    if (mounted) {
      setState(() {
        _isApplyingTrackChange = true;
      });
    }

    try {
      switch (choice.kind) {
        case _SubtitleChoiceKind.disable:
          await playerNotifier.disableSubtitles();
          if (!mounted) return;
          setState(() {
            _subtitleSelectionKey = 'off';
            _subtitleSelectionLabel = 'Désactivés';
          });
          break;
        case _SubtitleChoiceKind.embedded:
          final track = choice.embeddedTrack!;
          await playerNotifier.setEmbeddedSubtitleTrack(track);
          if (!mounted) return;
          setState(() {
            _subtitleSelectionKey = 'embedded:${track.id}';
            _subtitleSelectionLabel = '${track.label} (intégré)';
          });
          break;
        case _SubtitleChoiceKind.openSubtitle:
          final entry = choice.openSubtitle!;
          final appliedEntry = await _applyOpenSubtitleWithFallback(entry);
          if (!mounted) return;
          setState(() {
            _subtitleSelectionKey = _openSubtitleSelectionKey(appliedEntry);
            _subtitleSelectionLabel =
                '${appliedEntry.displayName} (OpenSubtitles Pro)';
          });
          if (appliedEntry.fileId != entry.fileId) {
            _showInfoSnackBar(
              'Sous-titre alternatif chargé (${appliedEntry.displayName}).',
            );
          }
          break;
      }
    } catch (_) {
      if (!mounted) return;
      _showErrorSnackBar('Impossible de changer les sous-titres.');
    } finally {
      if (mounted) {
        setState(() {
          _isApplyingTrackChange = false;
        });
      }
    }
  }

  Future<void> _openSubtitleSyncSheet() async {
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            Future<void> apply(Future<void> Function() action) async {
              if (mounted) {
                setState(() {
                  _isApplyingTrackChange = true;
                });
              }
              try {
                await action();
                if (!mounted) return;
                _syncTrackSelections();
                setSheetState(() {});
              } catch (_) {
                if (!mounted) return;
                _showErrorSnackBar("Impossible d'appliquer la synchro ST.");
              } finally {
                if (mounted) {
                  setState(() {
                    _isApplyingTrackChange = false;
                  });
                }
              }
            }

            final delayMs = playerNotifier.subtitleDelayMs;
            final scalePercent = ((playerNotifier.subtitleScale - 1.0) * 100);

            return _SelectorSheet(
              title: 'Synchronisation ST',
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.lg),
                children: [
                  _SyncStepperRow(
                    label: 'Décalage sous-titres',
                    hint: 'ms',
                    value: '${delayMs >= 0 ? '+' : ''}$delayMs',
                    onMinus: () =>
                        apply(() => playerNotifier.adjustSubtitleDelay(-250)),
                    onPlus: () =>
                        apply(() => playerNotifier.adjustSubtitleDelay(250)),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _SyncStepperRow(
                    label: 'Dérive temporelle',
                    hint: '%',
                    value:
                        '${scalePercent >= 0 ? '+' : ''}${scalePercent.toStringAsFixed(1)}',
                    onMinus: () =>
                        apply(() => playerNotifier.adjustSubtitleScale(-0.005)),
                    onPlus: () =>
                        apply(() => playerNotifier.adjustSubtitleScale(0.005)),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    'Actif sur la piste de sous-titres en cours (OpenSubtitles ou piste intégrée).',
                    style: const TextStyle(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  OutlinedButton.icon(
                    onPressed: () => apply(playerNotifier.resetSubtitleTiming),
                    icon: const Icon(Icons.restart_alt),
                    label: const Text('Réinitialiser'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textPrimary,
                      side: const BorderSide(color: AppColors.textSecondary),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<Map<int, String>> _resolveAudioLabels(List<PlayerTrack> tracks) async {
    final labels = <int, String>{
      for (final track in tracks) track.id: track.label,
    };

    try {
      final infos =
          await ref.read(transcodeRepositoryProvider).getAudioTracks();
      for (final info in infos) {
        final id = info.index;
        if (!labels.containsKey(id)) continue;
        labels[id] = _formatAudioTrackLabel(info);
      }
    } catch (_) {
      // FFprobe peut être indisponible; on garde les labels natifs media_kit.
    }

    return labels;
  }

  String _formatAudioTrackLabel(AudioTrackInfo info) {
    final base = info.displayName.trim();
    final details = <String>[];
    if (info.codec.isNotEmpty) details.add(info.codec.toUpperCase());
    if (info.channels > 0) details.add('${info.channels}ch');
    if (details.isEmpty) return base;
    return '$base • ${details.join(' • ')}';
  }

  String _openSubtitleSelectionKey(SubtitleEntry entry) {
    final release = entry.releaseName
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_');
    final releasePart = release.isEmpty ? 'na' : release;
    return 'open:${entry.fileId}:${entry.language.toLowerCase()}:$releasePart';
  }

  List<SubtitleEntry> _subtitleFallbackCandidates(SubtitleEntry preferred) {
    final preferredLanguage = preferred.language.toLowerCase().trim();
    final preferredScore = _subtitleReleaseMatchScore(preferred);
    final sameLanguage = _openSubtitles
        .where(
          (entry) =>
              entry.fileId != preferred.fileId &&
              entry.language.toLowerCase().trim() == preferredLanguage,
        )
        .toList(growable: false)
      ..sort((a, b) =>
          _subtitleReleaseMatchScore(b) - _subtitleReleaseMatchScore(a));

    final releaseMatched = sameLanguage.where((entry) {
      final score = _subtitleReleaseMatchScore(entry);
      if (score <= 0) return false;
      if (preferredScore <= 0) return true;
      return score >= preferredScore - 2;
    }).take(2);
    return [preferred, ...releaseMatched];
  }

  int _subtitleReleaseMatchScore(SubtitleEntry entry) {
    final activeSource = _currentSource();
    if (activeSource == null) return 0;

    final sourceName = activeSource.name.trim().toLowerCase();
    final releaseName = entry.releaseName.trim().toLowerCase();
    if (sourceName.isEmpty || releaseName.isEmpty) return 0;

    final normalizedSource = _normalizeReleaseLabel(sourceName);
    final normalizedRelease = _normalizeReleaseLabel(releaseName);
    if (normalizedSource.isEmpty || normalizedRelease.isEmpty) return 0;

    var score = 0;
    if (normalizedSource == normalizedRelease) score += 12;
    if (normalizedSource.contains(normalizedRelease) ||
        normalizedRelease.contains(normalizedSource)) {
      score += 8;
    }

    final sourceTokens = _releaseTokens(sourceName);
    final releaseTokens = _releaseTokens(releaseName);
    if (sourceTokens.isEmpty || releaseTokens.isEmpty) return score;

    for (final token in releaseTokens) {
      if (!sourceTokens.contains(token)) continue;
      if (RegExp(r'^\d{3,4}p$').hasMatch(token)) {
        score += 3;
        continue;
      }
      if (RegExp(
              r'^(x26[45]|h\.?26[45]|hevc|xvid|bluray|brrip|webrip|webdl|web-dl|hdrip|dvdrip)$')
          .hasMatch(token)) {
        score += 2;
        continue;
      }
      if (token.length >= 4) {
        score += 1;
      }
    }

    return score;
  }

  String _normalizeReleaseLabel(String value) {
    return value
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  Set<String> _releaseTokens(String value) {
    final normalized = _normalizeReleaseLabel(value);
    if (normalized.isEmpty) return const {};
    return normalized.split(' ').where((token) => token.length >= 2).toSet();
  }

  Future<SubtitleEntry> _applyOpenSubtitleWithFallback(
      SubtitleEntry preferred) async {
    final repo = ref.read(subtitleRepositoryProvider);
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);

    final candidates = _subtitleFallbackCandidates(preferred);
    final deadline = DateTime.now().add(const Duration(seconds: 8));
    Object? lastError;

    for (final entry in candidates.take(4)) {
      final remaining = deadline.difference(DateTime.now());
      if (remaining <= Duration.zero) break;

      final perAttemptTimeout = remaining > const Duration(seconds: 4)
          ? const Duration(seconds: 4)
          : remaining;

      try {
        final subtitleUrl = await repo.downloadSubtitle(
          entry.fileId,
          entry.language,
          timeout: perAttemptTimeout,
        );
        await playerNotifier.loadSubtitle(
          _withCacheBust(subtitleUrl),
          timeout: perAttemptTimeout,
        );
        return entry;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError != null) {
      throw lastError;
    }
    throw Exception('SUBTITLE_LOAD_FAILED');
  }

  String _withCacheBust(String url) {
    final uri = Uri.parse(url);
    final params = Map<String, String>.from(uri.queryParameters);
    params['_ts'] = DateTime.now().millisecondsSinceEpoch.toString();
    return uri.replace(queryParameters: params).toString();
  }

  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.surfaceVariant,
        content: Text(message),
      ),
    );
  }

  void _showInfoSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AppColors.surfaceVariant,
        content: Text(message),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _goBackToDetail() {
    if (!mounted) return;
    context.go('/detail/${widget.mediaType}/${widget.tmdbId}');
  }

  TorrentSource? _currentSource() {
    if (_activeSourceKey == null) return null;
    for (final source in _sources) {
      if (source.key == _activeSourceKey) return source;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(videoPlayerNotifierProvider, (_, next) {
      _onPlaybackStateChanged(next);
    });

    final playerState = ref.watch(videoPlayerNotifierProvider);
    final playerNotifier = ref.read(videoPlayerNotifierProvider.notifier);
    final activeSource = _currentSource();
    final introMarker = _activeIntroMarker(playerState.position);
    final showAutoNextOverlay =
        _canGoToNextEpisode && !_autoNextCancelled && _autoNextTimer != null;
    final isBusy = _isBootstrapping ||
        playerState.isLoading ||
        _isSwitchingSource ||
        _isApplyingTrackChange;

    if (_fatalError != null) {
      return Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: ErrorRetryWidget(
            message: _fatalError!,
            onRetry: _bootstrap,
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: _isInPictureInPicture
            ? Stack(
                fit: StackFit.expand,
                children: [
                  Video(
                    controller: playerNotifier.videoController,
                    fit: BoxFit.contain,
                    controls: NoVideoControls,
                    subtitleViewConfiguration:
                        const SubtitleViewConfiguration(),
                  ),
                  if (isBusy)
                    const ColoredBox(
                      color: Colors.black26,
                    ),
                ],
              )
            : Column(
                children: [
                  _PlayerHeader(
                    title: widget.mediaType == 'tv'
                        ? 'Lecture série'
                        : 'Lecture film',
                    subtitle: widget.mediaType == 'tv' &&
                            widget.season != null &&
                            widget.episode != null
                        ? 'S${widget.season} E${widget.episode}'
                        : 'TMDB ${widget.tmdbId}',
                    loading: _isSwitchingSource || _isApplyingTrackChange,
                    onBack: _goBackToDetail,
                    actions: [
                      _HeaderAction(
                        icon: Icons.hub_outlined,
                        label: 'Sources (${_sources.length})',
                        onTap: _openSourceSelector,
                        loading: _isLoadingSources,
                      ),
                      _HeaderAction(
                        icon: Icons.fast_rewind,
                        label: '-15s',
                        onTap: _seekBackward15,
                      ),
                      _HeaderAction(
                        icon: Icons.fast_forward,
                        label: '+15s',
                        onTap: _seekForward15,
                      ),
                      _HeaderAction(
                        icon: Icons.audiotrack,
                        label: 'Audio',
                        onTap: _openAudioSelector,
                      ),
                      _HeaderAction(
                        icon: Icons.subtitles_outlined,
                        label: 'Sous-titres',
                        onTap: _openSubtitleSelector,
                        loading: _isLoadingSubtitles,
                      ),
                      _HeaderAction(
                        icon: Icons.tune,
                        label: 'Sync ST',
                        onTap: _openSubtitleSyncSheet,
                      ),
                      _HeaderAction(
                        icon: Icons.refresh,
                        label: 'Rafraîchir ST',
                        onTap: _loadOpenSubtitles,
                        loading: _isLoadingSubtitles,
                      ),
                      _HeaderAction(
                        icon: Icons.skip_previous,
                        label: 'Épisode -',
                        onTap: _goToPreviousEpisode,
                        enabled: _canGoToPreviousEpisode,
                      ),
                      _HeaderAction(
                        icon: Icons.skip_next,
                        label: 'Épisode +',
                        onTap: _goToNextEpisode,
                        enabled: _canGoToNextEpisode,
                      ),
                    ],
                  ),
                  Expanded(
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Video(
                          controller: playerNotifier.videoController,
                          fit: BoxFit.contain,
                          controls: AdaptiveVideoControls,
                          subtitleViewConfiguration:
                              const SubtitleViewConfiguration(),
                        ),
                        if (isBusy)
                          Container(
                            color: Colors.black38,
                            child: const Center(
                              child: CircularProgressIndicator(
                                color: AppColors.primary,
                              ),
                            ),
                          ),
                        if (introMarker != null)
                          Positioned(
                            right: AppSpacing.lg,
                            bottom: AppSpacing.lg,
                            child: ElevatedButton.icon(
                              onPressed: () => _skipIntro(introMarker),
                              icon: const Icon(Icons.skip_next),
                              label: const Text('Passer l\'intro'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.primary,
                                foregroundColor: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        if (showAutoNextOverlay)
                          Positioned(
                            left: AppSpacing.lg,
                            bottom: AppSpacing.lg,
                            child: _AutoNextCard(
                              remainingSeconds: _autoNextRemainingSeconds,
                              onCancel: _cancelAutoNextForCurrentEpisode,
                              onPlayNow: _goToNextEpisode,
                            ),
                          ),
                      ],
                    ),
                  ),
                  _PlayerInfoBar(
                    source: activeSource == null
                        ? 'Auto'
                        : '${activeSource.resolution} • ${activeSource.sizeLabel}',
                    audio: _activeAudioTrackLabel,
                    subtitles: _subtitleSelectionLabel,
                    subtitleCount: _openSubtitles.length,
                  ),
                ],
              ),
      ),
    );
  }

  Future<String?> _startNativePlayback(
    VideoPlayerNotifier playerNotifier, {
    String? sourceKey,
  }) async {
    final probe = sourceKey == null
        ? const _SourceProbeResult(ok: false)
        : await _probeSourceAvailability(
            sourceKey,
            timeout: const Duration(seconds: 3),
          );
    final effectiveSourceKey = probe.selectedSourceKey ?? sourceKey;
    await playerNotifier.loadStream(
      tmdbId: widget.tmdbId,
      mediaType: widget.mediaType,
      profileId: widget.profileId,
      season: widget.season,
      episode: widget.episode,
      startPosition: widget.startPosition,
      sourceKey: effectiveSourceKey,
    );
    if (mounted &&
        effectiveSourceKey != null &&
        effectiveSourceKey.isNotEmpty &&
        effectiveSourceKey != _activeSourceKey) {
      setState(() {
        _activeSourceKey = effectiveSourceKey;
      });
    }
    return effectiveSourceKey;
  }

  Future<void> _applyAudioTrackChange(
    VideoPlayerNotifier playerNotifier,
    PlayerTrack selectedTrack,
  ) async {
    await playerNotifier.setAudioTrack(selectedTrack);
  }
}

class _SourceProbeResult {
  final bool ok;
  final String? selectedSourceKey;

  const _SourceProbeResult({
    required this.ok,
    this.selectedSourceKey,
  });
}

class _HeaderAction {
  final IconData icon;
  final String label;
  final Future<void> Function() onTap;
  final bool loading;
  final bool enabled;

  const _HeaderAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.loading = false,
    this.enabled = true,
  });
}

class _PlayerHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool loading;
  final VoidCallback onBack;
  final List<_HeaderAction> actions;

  const _PlayerHeader({
    required this.title,
    required this.subtitle,
    required this.loading,
    required this.onBack,
    required this.actions,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background.withValues(alpha: 0.94),
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.sm, AppSpacing.xs, AppSpacing.sm, AppSpacing.sm),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                onPressed: onBack,
                icon:
                    const Icon(Icons.arrow_back, color: AppColors.textPrimary),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (loading)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: actions
                  .map(
                    (action) => Padding(
                      padding: const EdgeInsets.only(right: AppSpacing.sm),
                      child: OutlinedButton.icon(
                        onPressed: action.loading || !action.enabled
                            ? null
                            : action.onTap,
                        icon: action.loading
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Icon(action.icon, size: 16),
                        label: Text(action.label),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          side:
                              const BorderSide(color: AppColors.surfaceVariant),
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _AutoNextCard extends StatelessWidget {
  final int remainingSeconds;
  final VoidCallback onCancel;
  final Future<void> Function() onPlayNow;

  const _AutoNextCard({
    required this.remainingSeconds,
    required this.onCancel,
    required this.onPlayNow,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.background.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(AppTheme.borderRadius),
        border: Border.all(color: AppColors.surfaceVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Épisode suivant dans ${remainingSeconds}s',
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          TextButton(
            onPressed: onCancel,
            child: const Text('Annuler'),
          ),
          const SizedBox(width: AppSpacing.xs),
          ElevatedButton(
            onPressed: onPlayNow,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.textPrimary,
            ),
            child: const Text('Lire'),
          ),
        ],
      ),
    );
  }
}

class _PlayerInfoBar extends StatelessWidget {
  final String source;
  final String audio;
  final String subtitles;
  final int subtitleCount;

  const _PlayerInfoBar({
    required this.source,
    required this.audio,
    required this.subtitles,
    required this.subtitleCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background.withValues(alpha: 0.94),
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _InfoPill(label: 'Source', value: source),
            const SizedBox(width: AppSpacing.sm),
            _InfoPill(label: 'Audio', value: audio),
            const SizedBox(width: AppSpacing.sm),
            _InfoPill(label: 'Sous-titres', value: subtitles),
            const SizedBox(width: AppSpacing.sm),
            _InfoPill(
                label: 'OpenSubtitles Pro', value: '$subtitleCount trouvés'),
          ],
        ),
      ),
    );
  }
}

class _InfoPill extends StatelessWidget {
  final String label;
  final String value;

  const _InfoPill({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(999),
      ),
      child: RichText(
        text: TextSpan(
          children: [
            TextSpan(
              text: '$label: ',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
            TextSpan(
              text: value,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectorSheet extends StatelessWidget {
  final String title;
  final Widget child;

  const _SelectorSheet({
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return SafeArea(
      child: SizedBox(
        height: media.size.height * 0.78,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, AppSpacing.md, AppSpacing.sm, AppSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: AppColors.textPrimary),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

enum _SubtitleChoiceKind { disable, embedded, openSubtitle }

class _AudioSelectionData {
  final List<PlayerTrack> tracks;
  final PlayerTrack? activeTrack;
  final Map<int, String> labelsByTrackId;

  const _AudioSelectionData({
    required this.tracks,
    required this.activeTrack,
    required this.labelsByTrackId,
  });
}

class _SyncStepperRow extends StatelessWidget {
  final String label;
  final String hint;
  final String value;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  const _SyncStepperRow({
    required this.label,
    required this.hint,
    required this.value,
    required this.onMinus,
    required this.onPlus,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(AppSpacing.sm),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$value $hint',
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onMinus,
            icon: const Icon(Icons.remove_circle_outline),
            color: AppColors.textPrimary,
          ),
          IconButton(
            onPressed: onPlus,
            icon: const Icon(Icons.add_circle_outline),
            color: AppColors.textPrimary,
          ),
        ],
      ),
    );
  }
}

class _SubtitleChoice {
  final _SubtitleChoiceKind kind;
  final PlayerTrack? embeddedTrack;
  final SubtitleEntry? openSubtitle;

  const _SubtitleChoice._({
    required this.kind,
    this.embeddedTrack,
    this.openSubtitle,
  });

  const _SubtitleChoice.disable() : this._(kind: _SubtitleChoiceKind.disable);

  const _SubtitleChoice.embedded(PlayerTrack track)
      : this._(
          kind: _SubtitleChoiceKind.embedded,
          embeddedTrack: track,
        );

  const _SubtitleChoice.openSubtitle(SubtitleEntry entry)
      : this._(
          kind: _SubtitleChoiceKind.openSubtitle,
          openSubtitle: entry,
        );
}
// Video player with streaming and subtitle support
// Implements gesture controls, picture-in-picture, and auto-play
// Handles Real-Debrid streaming proxy and multiple source fallbacks
