import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';

part 'search_screen.g.dart';

@riverpod
Future<List<Map<String, dynamic>>> searchResults(Ref ref, String query) async {
  if (query.trim().length < 2) return [];
  final dio = ref.watch(apiClientProvider).dio;
  final response = await dio.get('/api/search', queryParameters: {'q': query});
  final data = response.data['data'] as List? ?? [];
  return data.cast<Map<String, dynamic>>();
}

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _ctrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Barre de recherche
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: TextField(
                controller: _ctrl,
                autofocus: false,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Films, séries…',
                  hintStyle: const TextStyle(color: AppColors.textSecondary),
                  prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear, color: AppColors.textSecondary),
                          onPressed: () {
                            _ctrl.clear();
                            setState(() => _query = '');
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.borderRadius),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(AppTheme.borderRadius),
                    borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
                  ),
                ),
                onChanged: (v) => setState(() => _query = v),
              ),
            ),

            // Résultats
            Expanded(child: _SearchResults(query: _query)),
          ],
        ),
      ),
    );
  }
}

class _SearchResults extends ConsumerWidget {
  final String query;
  const _SearchResults({required this.query});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (query.trim().length < 2) {
      return const Center(
        child: Text(
          'Tapez au moins 2 caractères pour rechercher',
          style: TextStyle(color: AppColors.textSecondary),
          textAlign: TextAlign.center,
        ),
      );
    }

    final resultsAsync = ref.watch(searchResultsProvider(query));

    return resultsAsync.when(
      loading: () => const Center(
        child: CircularProgressIndicator(color: AppColors.primary),
      ),
      error: (_, __) => const Center(
        child: Text('Erreur de recherche', style: TextStyle(color: AppColors.textSecondary)),
      ),
      data: (results) {
        if (results.isEmpty) {
          return Center(
            child: Text(
              'Aucun résultat pour "$query"',
              style: const TextStyle(color: AppColors.textSecondary),
            ),
          );
        }
        return GridView.builder(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            childAspectRatio: 2 / 3,
            crossAxisSpacing: AppSpacing.sm,
            mainAxisSpacing: AppSpacing.sm,
          ),
          itemCount: results.length,
          itemBuilder: (context, i) => _SearchTile(item: results[i]),
        );
      },
    );
  }
}

class _SearchTile extends StatelessWidget {
  final Map<String, dynamic> item;
  const _SearchTile({required this.item});

  @override
  Widget build(BuildContext context) {
    final tmdbId = item['tmdb_id'].toString();
    final mediaType = item['media_type'] as String? ?? 'movie';
    final title = item['title'] as String? ?? item['name'] as String? ?? '';
    final posterUrl = item['poster_url'] as String?;

    return GestureDetector(
      onTap: () => context.push('/detail/$mediaType/$tmdbId'),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.borderRadius),
        child: posterUrl != null
            ? CachedNetworkImage(
                imageUrl: posterUrl,
                fit: BoxFit.cover,
                placeholder: (_, __) => Container(color: AppColors.surface),
                errorWidget: (_, __, ___) => _Placeholder(title: title),
              )
            : _Placeholder(title: title),
      ),
    );
  }
}

class _Placeholder extends StatelessWidget {
  final String title;
  const _Placeholder({required this.title});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Text(
            title,
            textAlign: TextAlign.center,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
          ),
        ),
      ),
    );
  }
}
// Search
