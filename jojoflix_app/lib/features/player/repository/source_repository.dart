import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:dio/dio.dart';
import '../../../core/network/api_client.dart';

part 'source_repository.g.dart';

@riverpod
SourceRepository sourceRepository(Ref ref) {
  return SourceRepository(apiClient: ref.watch(apiClientProvider));
}

class TorrentSource {
  final String key;
  final String name;
  final String resolution;
  final double? sizeGb;
  final List<String> tags;
  final int score;
  final int? preferenceRank;
  final int? cachedRank;
  final String provider;
  final String magnet;
  final bool hasDirectUrl;

  const TorrentSource({
    required this.key,
    required this.name,
    required this.resolution,
    this.sizeGb,
    required this.tags,
    required this.score,
    this.preferenceRank,
    this.cachedRank,
    required this.provider,
    required this.magnet,
    required this.hasDirectUrl,
  });

  factory TorrentSource.fromJson(Map<String, dynamic> json) {
    final key = json['key']?.toString();
    return TorrentSource(
      key: key != null && key.isNotEmpty
          ? key
          : (json['info_hash'] as String? ??
              json['magnet'] as String? ??
              json['name'] as String? ??
              ''),
      name: json['name'] as String,
      resolution: json['resolution'] as String,
      sizeGb: (json['size_gb'] as num?)?.toDouble(),
      tags: (json['tags'] as List?)?.cast<String>() ?? [],
      score: json['score'] as int,
      preferenceRank: (json['preference_rank'] as num?)?.toInt(),
      cachedRank: (json['cached_rank'] as num?)?.toInt(),
      provider: (json['provider'] as String? ?? '').toLowerCase(),
      magnet: json['magnet'] as String? ?? '',
      hasDirectUrl: json['has_direct_url'] as bool? ?? false,
    );
  }

  String get sizeLabel {
    if (sizeGb == null) return '?';
    return '${sizeGb!.toStringAsFixed(1)} Go';
  }

  String get providerLabel {
    if (provider == 'mediafusion') return 'MediaFusion';
    if (provider == 'torrentio') return 'Torrentio';
    if (provider == 'dramayo') return 'DramaYo';
    return hasDirectUrl ? 'MediaFusion' : 'Torrentio';
  }
}

class SourceRepository {
  final ApiClient apiClient;
  SourceRepository({required this.apiClient});

  Future<List<TorrentSource>> getMovieSources(
    String tmdbId, {
    bool includeSlowProviders = false,
  }) async {
    final response = await apiClient.dio.get(
      '/api/sources/movie/$tmdbId',
      queryParameters:
          includeSlowProviders ? const {'providers': 'full'} : null,
    );
    final data = response.data['data'] as List;
    return data
        .map((json) => TorrentSource.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<List<TorrentSource>> getTvSources(
    String tmdbId,
    int season,
    int episode, {
    bool includeSlowProviders = false,
  }) async {
    final response = await apiClient.dio.get(
      '/api/sources/tv/$tmdbId/s/$season/e/$episode',
      queryParameters:
          includeSlowProviders ? const {'providers': 'full'} : null,
    );
    final data = response.data['data'] as List;
    return data
        .map((json) => TorrentSource.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  String getStreamUrl(String tmdbId, String mediaType,
      {int? season, int? episode}) {
    if (mediaType == 'tv' && season != null && episode != null) {
      return '/api/stream/tv/$tmdbId/s/$season/e/$episode';
    }
    return '/api/stream/movie/$tmdbId';
  }

  Future<void> prewarmNextEpisode(
    String tmdbId,
    int season,
    int episode, {
    String? sourceKey,
  }) async {
    final query = <String, dynamic>{};
    if (sourceKey != null && sourceKey.isNotEmpty) {
      query['source_key'] = sourceKey;
    }

    await apiClient.dio.get(
      '/api/stream/prewarm/tv/$tmdbId/s/$season/e/$episode',
      queryParameters: query.isEmpty ? null : query,
      options: Options(
        sendTimeout: const Duration(seconds: 2),
        receiveTimeout: const Duration(seconds: 3),
      ),
    );
  }
}
// Sources
