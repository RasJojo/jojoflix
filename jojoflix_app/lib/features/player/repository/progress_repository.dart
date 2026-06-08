import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';

part 'progress_repository.g.dart';

@riverpod
ProgressRepository progressRepository(Ref ref) {
  return ProgressRepository(apiClient: ref.watch(apiClientProvider));
}

class ProgressRepository {
  final ApiClient apiClient;
  ProgressRepository({required this.apiClient});

  Future<void> syncProgress({
    required String profileId,
    required String tmdbId,
    required String mediaType,
    int? seasonNum,
    int? episodeNum,
    required int currentTime,
    required int totalDuration,
  }) async {
    try {
      await apiClient.dio.post('/api/progress/sync', data: {
        'profile_id': profileId,
        'tmdb_id': tmdbId,
        'media_type': mediaType,
        if (seasonNum != null) 'season_num': seasonNum,
        if (episodeNum != null) 'episode_num': episodeNum,
        'current_time': currentTime,
        'total_duration': totalDuration,
      });
    } on DioException catch (error) {
      if (kDebugMode) {
        final status = error.response?.statusCode;
        // ignore: avoid_print
        print(
          '[ProgressSync] ${error.requestOptions.method} '
          '${error.requestOptions.path} -> $status | '
          'request=${error.requestOptions.data} | '
          'response=${error.response?.data}',
        );
      }
      rethrow;
    }
  }
}
// Progress
