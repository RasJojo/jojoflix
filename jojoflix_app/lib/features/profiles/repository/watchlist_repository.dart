import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';

final watchlistRepositoryProvider = Provider<WatchlistRepository>((ref) {
  return WatchlistRepository(apiClient: ref.watch(apiClientProvider));
});

class WatchlistItem {
  final String tmdbId;
  final String mediaType;
  final String title;
  final String? posterUrl;
  final String? backdropUrl;
  final String? addedAt;

  const WatchlistItem({
    required this.tmdbId,
    required this.mediaType,
    required this.title,
    this.posterUrl,
    this.backdropUrl,
    this.addedAt,
  });

  factory WatchlistItem.fromJson(Map<String, dynamic> json) {
    return WatchlistItem(
      tmdbId: json['tmdb_id'].toString(),
      mediaType: json['media_type'] as String? ?? 'movie',
      title: json['title'] as String? ?? '',
      posterUrl: json['poster_url'] as String?,
      backdropUrl: json['backdrop_url'] as String?,
      addedAt: json['added_at'] as String?,
    );
  }
}

class WatchlistRepository {
  final ApiClient apiClient;
  WatchlistRepository({required this.apiClient});

  Future<List<WatchlistItem>> getWatchlist(int profileId) async {
    final response =
        await apiClient.dio.get('/api/profiles/$profileId/watchlist');
    final data = response.data['data'] as List? ?? [];
    return data
        .map((item) => WatchlistItem.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<WatchlistItem>> add(
      int profileId, String tmdbId, String mediaType) async {
    final response = await apiClient.dio.post(
      '/api/profiles/$profileId/watchlist',
      data: {'tmdb_id': tmdbId, 'media_type': mediaType},
    );
    final data = response.data['data'] as List? ?? [];
    return data
        .map((item) => WatchlistItem.fromJson(item as Map<String, dynamic>))
        .toList();
  }

  Future<List<WatchlistItem>> remove(
      int profileId, String tmdbId, String mediaType) async {
    final response = await apiClient.dio
        .delete('/api/profiles/$profileId/watchlist/$mediaType/$tmdbId');
    final data = response.data['data'] as List? ?? [];
    return data
        .map((item) => WatchlistItem.fromJson(item as Map<String, dynamic>))
        .toList();
  }
}
