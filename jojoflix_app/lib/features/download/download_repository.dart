import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../core/network/api_client.dart';

part 'download_repository.g.dart';

@riverpod
DownloadRepository downloadRepository(Ref ref) {
  return DownloadRepository(apiClient: ref.watch(apiClientProvider));
}

class DownloadUrlResult {
  final String directUrl;
  final String sourceKey;
  final double? sizeGb;

  const DownloadUrlResult({
    required this.directUrl,
    required this.sourceKey,
    this.sizeGb,
  });
}

class DownloadRepository {
  final ApiClient apiClient;
  DownloadRepository({required this.apiClient});

  Future<DownloadUrlResult> getMovieDownloadUrl(String tmdbId, {String? sourceKey}) async {
    final params = <String, dynamic>{};
    if (sourceKey != null) params['source_key'] = sourceKey;
    final response = await apiClient.dio.get(
      '/api/download/movie/$tmdbId',
      queryParameters: params.isEmpty ? null : params,
    );
    final data = response.data['data'] as Map<String, dynamic>;
    return DownloadUrlResult(
      directUrl: data['direct_url'] as String,
      sourceKey: data['source_key'] as String,
      sizeGb: (data['size_gb'] as num?)?.toDouble(),
    );
  }

  Future<DownloadUrlResult> getTvDownloadUrl(
    String tmdbId,
    int season,
    int episode, {
    String? sourceKey,
  }) async {
    final params = <String, dynamic>{};
    if (sourceKey != null) params['source_key'] = sourceKey;
    final response = await apiClient.dio.get(
      '/api/download/tv/$tmdbId/s/$season/e/$episode',
      queryParameters: params.isEmpty ? null : params,
    );
    final data = response.data['data'] as Map<String, dynamic>;
    return DownloadUrlResult(
      directUrl: data['direct_url'] as String,
      sourceKey: data['source_key'] as String,
      sizeGb: (data['size_gb'] as num?)?.toDouble(),
    );
  }
}
