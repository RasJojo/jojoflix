import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';
import '../../browse/widget/browse_screen.dart';
import '../../home/repository/home_repository.dart';

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
  final _focusNode = FocusNode();
  String _query = '';
  String _debouncedQuery = '';
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _focusNode.requestFocus());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _ctrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _onQueryChanged(String v) {
    setState(() => _query = v);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _debouncedQuery = v);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: TextField(
                controller: _ctrl,
                focusNode: _focusNode,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: InputDecoration(
                  hintText: 'Films, séries…',
                  hintStyle:
                      const TextStyle(color: AppColors.textSecondary),
                  prefixIcon: const Icon(Icons.search,
                      color: AppColors.textSecondary),
                  suffixIcon: _query.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear,
                              color: AppColors.textSecondary),
                          onPressed: () {
                            _ctrl.clear();
                            _debounce?.cancel();
                            setState(() {
                              _query = '';
                              _debouncedQuery = '';
                            });
                          },
                        )
                      : null,
                  filled: true,
                  fillColor: AppColors.surface,
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(AppTheme.borderRadius),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(AppTheme.borderRadius),
                    borderSide: const BorderSide(
                        color: AppColors.primary, width: 1.5),
                  ),
                ),
                onChanged: _onQueryChanged,
              ),
            ),
            Expanded(child: _SearchResults(query: _debouncedQuery)),
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
      return _SearchTrending();
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
        final width = MediaQuery.of(context).size.width;
        final cols = width >= 1200
            ? 6
            : width >= 800
                ? 5
                : width >= 600
                    ? 4
                    : 3;
        return GridView.builder(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: cols,
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

class _SearchTrending extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final moviesAsync = ref.watch(browseRowsProvider('movie'));
    final tvAsync = ref.watch(browseRowsProvider('tv'));

    if (moviesAsync.isLoading && tvAsync.isLoading) {
      return const JojoflixLoader();
    }

    final movies = moviesAsync.valueOrNull;
    final tv = tvAsync.valueOrNull;

    final List<HomeRow> rows = [
      if (movies != null && movies.isNotEmpty) movies.first,
      if (tv != null && tv.isNotEmpty) tv.first,
    ];

    if (rows.isEmpty) return const SizedBox.shrink();

    return ListView(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
          child: const Text(
            'Tendances',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        for (final row in rows) _TrendingRow(row: row),
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}

class _TrendingRow extends StatelessWidget {
  final HomeRow row;
  const _TrendingRow({required this.row});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
          child: Text(
            row.title,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        SizedBox(
          height: 160,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            itemCount: row.items.length,
            separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.sm),
            itemBuilder: (context, i) {
              final item = row.items[i];
              return GestureDetector(
                onTap: () =>
                    context.push('/detail/${item.mediaType}/${item.tmdbId}'),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: SizedBox(
                    width: 100,
                    child: item.posterUrl != null
                        ? CachedNetworkImage(
                            imageUrl: item.posterUrl!,
                            fit: BoxFit.cover,
                            placeholder: (_, __) =>
                                Container(color: AppColors.surface),
                          )
                        : Container(
                            color: AppColors.surface,
                            child: Center(
                              child: Text(
                                item.title,
                                textAlign: TextAlign.center,
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 11),
                              ),
                            ),
                          ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
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
