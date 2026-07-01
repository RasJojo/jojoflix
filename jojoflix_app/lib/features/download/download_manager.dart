import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/network/api_client.dart';
import '../player/repository/subtitle_repository.dart';
import 'download_repository.dart';

/// Dedicated Dio instance for large file streaming.
/// The shared ApiClient Dio has a 30s receiveTimeout which fires before the
/// server finishes RD resolution (can take 60-70s). Using receiveTimeout=null
/// disables the read deadline so the server can take as long as it needs.
Dio _buildDownloadDio(String baseUrl) => Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 30),
        receiveTimeout: null,
      ),
    );

// ── Public helpers ────────────────────────────────────────────────────────────

String downloadItemId({
  required String tmdbId,
  required String mediaType,
  int? season,
  int? episode,
}) {
  if (mediaType == 'tv') return 'tv_${tmdbId}_s${season}_e$episode';
  return 'movie_$tmdbId';
}

// ── Models ────────────────────────────────────────────────────────────────────

class DownloadedSubtitle {
  final String language;
  final String displayName;
  final String path;

  const DownloadedSubtitle({
    required this.language,
    required this.displayName,
    required this.path,
  });

  factory DownloadedSubtitle.fromJson(Map<String, dynamic> json) {
    return DownloadedSubtitle(
      language: json['language'] as String,
      displayName: json['display_name'] as String,
      path: json['path'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'language': language,
        'display_name': displayName,
        'path': path,
      };
}

class DownloadedItem {
  final String id;
  final String tmdbId;
  final String mediaType;
  final int? season;
  final int? episode;
  final String title;
  final String? episodeLabel;
  final String? artworkUrl;
  final String videoPath;
  final List<DownloadedSubtitle> subtitles;
  final double? sizeGb;
  final DateTime downloadedAt;

  const DownloadedItem({
    required this.id,
    required this.tmdbId,
    required this.mediaType,
    this.season,
    this.episode,
    required this.title,
    this.episodeLabel,
    this.artworkUrl,
    required this.videoPath,
    required this.subtitles,
    this.sizeGb,
    required this.downloadedAt,
  });

  factory DownloadedItem.fromJson(Map<String, dynamic> json) {
    return DownloadedItem(
      id: json['id'] as String,
      tmdbId: json['tmdb_id'] as String,
      mediaType: json['media_type'] as String,
      season: (json['season'] as num?)?.toInt(),
      episode: (json['episode'] as num?)?.toInt(),
      title: json['title'] as String,
      episodeLabel: json['episode_label'] as String?,
      artworkUrl: json['artwork_url'] as String?,
      videoPath: json['video_path'] as String,
      subtitles: (json['subtitles'] as List? ?? [])
          .cast<Map<String, dynamic>>()
          .map(DownloadedSubtitle.fromJson)
          .toList(),
      sizeGb: (json['size_gb'] as num?)?.toDouble(),
      downloadedAt: DateTime.parse(json['downloaded_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'tmdb_id': tmdbId,
        'media_type': mediaType,
        'season': season,
        'episode': episode,
        'title': title,
        'episode_label': episodeLabel,
        'artwork_url': artworkUrl,
        'video_path': videoPath,
        'subtitles': subtitles.map((s) => s.toJson()).toList(),
        'size_gb': sizeGb,
        'downloaded_at': downloadedAt.toIso8601String(),
      };
}

// ── Task state ────────────────────────────────────────────────────────────────

enum DownloadTaskStatus { queued, downloading, error }

class DownloadTask {
  final String id;
  final DownloadTaskStatus status;
  final double progress;
  final String? error;
  final String? label;

  const DownloadTask({
    required this.id,
    required this.status,
    this.progress = 0.0,
    this.error,
    this.label,
  });
}

class SeasonEpisodeDownloadSpec {
  final int season;
  final int episode;
  final String episodeLabel;
  final String? artworkUrl;

  const SeasonEpisodeDownloadSpec({
    required this.season,
    required this.episode,
    required this.episodeLabel,
    this.artworkUrl,
  });
}

// ── Manager state ─────────────────────────────────────────────────────────────

class DownloadManagerState {
  final Map<String, DownloadTask> activeTasks;
  final List<DownloadedItem> completedDownloads;

  const DownloadManagerState({
    required this.activeTasks,
    required this.completedDownloads,
  });

  DownloadManagerState copyWith({
    Map<String, DownloadTask>? activeTasks,
    List<DownloadedItem>? completedDownloads,
  }) {
    return DownloadManagerState(
      activeTasks: activeTasks ?? this.activeTasks,
      completedDownloads: completedDownloads ?? this.completedDownloads,
    );
  }

  DownloadTask? taskFor(String id) => activeTasks[id];
  DownloadedItem? completedFor(String id) {
    for (final item in completedDownloads) {
      if (item.id == id) return item;
    }
    return null;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

final downloadManagerProvider =
    StateNotifierProvider<DownloadManagerNotifier, DownloadManagerState>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  final apiClient = ref.watch(apiClientProvider);
  final downloadDio = _buildDownloadDio(apiClient.dio.options.baseUrl);
  // Read auth token from SharedPreferences directly — same source as ApiClient.
  downloadDio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = prefs.getString('auth_token');
        if (token != null && !isLegacyAuthToken(token)) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        final profileId = prefs.getString('active_profile_id');
        if (profileId != null && !isLegacyProfileId(profileId)) {
          options.headers['X-Profile-Id'] = profileId;
        }
        handler.next(options);
      },
    ),
  );
  ref.onDispose(downloadDio.close);
  return DownloadManagerNotifier(
    prefs: prefs,
    downloadRepo: ref.watch(downloadRepositoryProvider),
    subtitleRepo: ref.watch(subtitleRepositoryProvider),
    dio: downloadDio,
  );
});

// ── Notifier ──────────────────────────────────────────────────────────────────

class DownloadManagerNotifier extends StateNotifier<DownloadManagerState> {
  DownloadManagerNotifier({
    required this.prefs,
    required this.downloadRepo,
    required this.subtitleRepo,
    required this.dio,
  }) : super(const DownloadManagerState(
            activeTasks: {}, completedDownloads: [])) {
    _loadPersisted();
  }

  final SharedPreferences prefs;
  final DownloadRepository downloadRepo;
  final SubtitleRepository subtitleRepo;
  final Dio dio;
  final Map<String, CancelToken> _cancelTokens = {};

  static const _prefsKey = 'jojoflix_downloads_v1';
  static const _dirName = 'jojoflix_downloads';
  static const _minimumVideoBytes = 1024 * 1024;

  void _loadPersisted() {
    final raw = prefs.getString(_prefsKey);
    if (raw == null) return;
    try {
      final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
      final items = list.map(DownloadedItem.fromJson).toList();
      // Filter out items whose file no longer exists
      final valid = items.where((item) {
        final file = File(item.videoPath);
        return file.existsSync() && file.lengthSync() >= _minimumVideoBytes;
      }).toList();
      state = state.copyWith(completedDownloads: valid);
      if (valid.length != items.length) {
        _persistDownloads(valid);
      }
    } catch (_) {}
  }

  Future<String> _getDir() async {
    final appDir = await getApplicationDocumentsDirectory();
    final dir = Directory('${appDir.path}/$_dirName');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir.path;
  }

  Future<void> startDownload({
    required String tmdbId,
    required String mediaType,
    required String title,
    int? season,
    int? episode,
    String? episodeLabel,
    String? artworkUrl,
    String? sourceKey,
  }) async {
    final id = downloadItemId(
      tmdbId: tmdbId,
      mediaType: mediaType,
      season: season,
      episode: episode,
    );

    if (state.activeTasks.containsKey(id)) return;
    if (state.completedDownloads.any((d) => d.id == id)) return;

    final cancelToken = CancelToken();
    _cancelTokens[id] = cancelToken;
    String? videoPath;
    _setTask(DownloadTask(
      id: id,
      status: DownloadTaskStatus.queued,
      label: episodeLabel ?? title,
    ));

    try {
      final dir = await _getDir();
      videoPath = '$dir/$id.mkv';

      _setTask(DownloadTask(
        id: id,
        status: DownloadTaskStatus.downloading,
        progress: 0.0,
        label: episodeLabel ?? title,
      ));

      // Download via server proxy — RD URLs are IP-locked to the server's IP,
      // so the client must download through the server, not directly from the CDN.
      final proxyUrl = mediaType == 'tv'
          ? '/api/download/stream/tv/$tmdbId/s/$season/e/$episode'
          : '/api/download/stream/movie/$tmdbId';

      final targetVideoPath = videoPath;
      await dio.download(
        proxyUrl,
        targetVideoPath,
        cancelToken: cancelToken,
        onReceiveProgress: (received, total) {
          if (total > 0 && !cancelToken.isCancelled) {
            _setTask(DownloadTask(
              id: id,
              status: DownloadTaskStatus.downloading,
              progress: received / total,
              label: episodeLabel ?? title,
            ));
          }
        },
      );

      if (cancelToken.isCancelled) {
        _cleanup(id, videoPath: videoPath);
        return;
      }

      // Compute size from actual file
      double? sizeGb;
      try {
        final fileSize = await File(targetVideoPath).length();
        if (fileSize < _minimumVideoBytes) {
          throw StateError('EMPTY_DOWNLOAD');
        }
        sizeGb = fileSize / (1024 * 1024 * 1024);
      } catch (_) {
        _cleanup(id, videoPath: targetVideoPath);
        _setTask(DownloadTask(
          id: id,
          status: DownloadTaskStatus.error,
          error: 'Fichier téléchargé vide',
          label: episodeLabel ?? title,
        ));
        return;
      }

      // Download subtitles (best-effort, non-blocking)
      final subtitles = await _downloadSubtitles(
        tmdbId: tmdbId,
        season: season,
        episode: episode,
        dir: dir,
        id: id,
      );

      final item = DownloadedItem(
        id: id,
        tmdbId: tmdbId,
        mediaType: mediaType,
        season: season,
        episode: episode,
        title: title,
        episodeLabel: episodeLabel,
        artworkUrl: artworkUrl,
        videoPath: targetVideoPath,
        subtitles: subtitles,
        sizeGb: sizeGb,
        downloadedAt: DateTime.now(),
      );

      final newList = [...state.completedDownloads, item];
      await _persistDownloads(newList);

      final newTasks = Map<String, DownloadTask>.from(state.activeTasks)
        ..remove(id);
      _cancelTokens.remove(id);
      state =
          state.copyWith(activeTasks: newTasks, completedDownloads: newList);
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel || cancelToken.isCancelled) {
        final newTasks = Map<String, DownloadTask>.from(state.activeTasks)
          ..remove(id);
        _cancelTokens.remove(id);
        state = state.copyWith(activeTasks: newTasks);
      } else {
        if (videoPath != null) {
          await _deleteFileIfExists(videoPath);
        }
        _cancelTokens.remove(id);
        _setTask(DownloadTask(
          id: id,
          status: DownloadTaskStatus.error,
          error: _describeDioError(e),
          label: episodeLabel ?? title,
        ));
      }
    } catch (e) {
      if (videoPath != null) {
        await _deleteFileIfExists(videoPath);
      }
      _cancelTokens.remove(id);
      _setTask(DownloadTask(
        id: id,
        status: DownloadTaskStatus.error,
        error: 'Erreur: $e',
        label: episodeLabel ?? title,
      ));
    }
  }

  Future<void> startSeasonDownload({
    required String tmdbId,
    required String title,
    required List<SeasonEpisodeDownloadSpec> episodes,
    String? artworkUrl,
  }) async {
    for (final episode in episodes) {
      await startDownload(
        tmdbId: tmdbId,
        mediaType: 'tv',
        title: title,
        season: episode.season,
        episode: episode.episode,
        episodeLabel: episode.episodeLabel,
        artworkUrl: episode.artworkUrl ?? artworkUrl,
      );
      await Future<void>.delayed(const Duration(milliseconds: 350));
    }
  }

  Future<List<DownloadedSubtitle>> _downloadSubtitles({
    required String tmdbId,
    int? season,
    int? episode,
    required String dir,
    required String id,
  }) async {
    try {
      final entries = await subtitleRepo.listSubtitles(
        tmdbId,
        season: season,
        episode: episode,
      );
      if (entries.isEmpty) return const [];

      // Prioritize French then English, take up to 3
      final sorted = [...entries]..sort((a, b) {
          int rank(String lang) {
            final l = lang.toLowerCase();
            if (l == 'fr' || l.startsWith('fr-') || l == 'french') return 0;
            if (l == 'en' || l.startsWith('en-') || l == 'english') return 1;
            return 2;
          }

          return rank(a.language).compareTo(rank(b.language));
        });

      final result = <DownloadedSubtitle>[];
      for (final entry in sorted.take(3)) {
        try {
          final proxyUrl =
              await subtitleRepo.downloadSubtitle(entry.fileId, entry.language);
          final res = await dio.get<String>(
            proxyUrl,
            options: Options(responseType: ResponseType.plain),
          );
          final content = res.data ?? '';
          if (content.trim().isEmpty) continue;
          final subPath = '$dir/${id}_${entry.language}.vtt';
          await File(subPath).writeAsString(content);
          result.add(DownloadedSubtitle(
            language: entry.language,
            displayName: entry.displayName,
            path: subPath,
          ));
        } catch (_) {
          // Best-effort — skip if a subtitle fails
        }
      }
      return result;
    } catch (_) {
      return const [];
    }
  }

  void cancelDownload(String id) {
    _cancelTokens[id]?.cancel('user_cancelled');
  }

  Future<void> deleteDownload(String id) async {
    final item = state.completedFor(id);
    if (item != null) {
      try {
        final videoFile = File(item.videoPath);
        if (videoFile.existsSync()) videoFile.deleteSync();
      } catch (_) {}
      for (final sub in item.subtitles) {
        try {
          final subFile = File(sub.path);
          if (subFile.existsSync()) subFile.deleteSync();
        } catch (_) {}
      }
    }
    final newList = state.completedDownloads.where((d) => d.id != id).toList();
    await _persistDownloads(newList);
    state = state.copyWith(completedDownloads: newList);
  }

  void dismissError(String id) {
    final newTasks = Map<String, DownloadTask>.from(state.activeTasks)
      ..remove(id);
    state = state.copyWith(activeTasks: newTasks);
  }

  String _describeDioError(DioException e) {
    final status = e.response?.statusCode;
    if (status == 404) return 'Aucune source disponible';
    if (status != null) {
      final data = e.response?.data;
      String? serverMsg;
      if (data is Map) {
        final errMap = data['error'];
        if (errMap is Map) serverMsg = errMap['message'] as String?;
      }
      return serverMsg != null
          ? 'Erreur serveur : $serverMsg'
          : 'Erreur serveur ($status)';
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout) {
      return 'Délai dépassé — réessaie';
    }
    if (e.type == DioExceptionType.connectionError) {
      return 'Connexion impossible';
    }
    return 'Téléchargement échoué';
  }

  void _setTask(DownloadTask task) {
    state = state.copyWith(
      activeTasks: {...state.activeTasks, task.id: task},
    );
  }

  void _cleanup(String id, {String? videoPath}) {
    if (videoPath != null) {
      try {
        final f = File(videoPath);
        if (f.existsSync()) f.deleteSync();
      } catch (_) {}
    }
    final newTasks = Map<String, DownloadTask>.from(state.activeTasks)
      ..remove(id);
    _cancelTokens.remove(id);
    state = state.copyWith(activeTasks: newTasks);
  }

  Future<void> _deleteFileIfExists(String filePath) async {
    try {
      final file = File(filePath);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }

  Future<void> _persistDownloads(List<DownloadedItem> items) async {
    final json = jsonEncode(items.map((e) => e.toJson()).toList());
    await prefs.setString(_prefsKey, json);
  }
}
