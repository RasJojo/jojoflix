import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../repository/home_repository.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';

part 'home_screen.g.dart';

@riverpod
Future<List<HomeRow>> homeRows(Ref ref) async {
  final repo = ref.watch(homeRepositoryProvider);
  final prefs = ref.watch(sharedPreferencesProvider);
  final profileIdStr = prefs.getString('active_profile_id');
  final profileId = int.tryParse(profileIdStr ?? '') ?? 0;
  return repo.getHomeRows(profileId);
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rowsAsync = ref.watch(homeRowsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: rowsAsync.when(
        loading: () => const JojoflixLoader(),
        error: (e, _) => ErrorRetryWidget(
          message: 'Impossible de charger le contenu',
          onRetry: () => ref.invalidate(homeRowsProvider),
        ),
        data: (rows) => _HomeContent(rows: rows),
      ),
    );
  }
}

void _openDetail(BuildContext context, HomeItem item) {
  context.push('/detail/${item.mediaType}/${item.tmdbId}');
}

void _resumePlayback(BuildContext context, HomeItem item) {
  final extra = <String, dynamic>{
    'startPosition': item.currentTime ?? 0,
    'title': item.title,
    'artworkUrl': item.backdropUrl,
  };
  if (item.mediaType == 'tv') {
    extra['season'] = item.seasonNum ?? 1;
    extra['episode'] = item.episodeNum ?? 1;
    extra['subtitle'] = 'S${item.seasonNum ?? 1} E${item.episodeNum ?? 1}';
  }
  context.push('/player/${item.mediaType}/${item.tmdbId}', extra: extra);
}

class _HomeContent extends StatelessWidget {
  final List<HomeRow> rows;
  const _HomeContent({required this.rows});

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const Center(
        child: Text('Aucun contenu disponible',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    return CustomScrollView(
      slivers: [
        // Hero banner (first item of first row)
        if (rows.isNotEmpty && rows.first.items.isNotEmpty)
          SliverToBoxAdapter(child: _HeroBanner(item: rows.first.items.first)),

        // Rows
        for (final row in rows)
          SliverToBoxAdapter(
            child: _MediaRow(row: row),
          ),

        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
      ],
    );
  }
}

class _HeroBanner extends StatelessWidget {
  final HomeItem item;
  const _HeroBanner({required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _openDetail(context, item),
      child: SizedBox(
        height: 480,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (item.backdropUrl != null)
              CachedNetworkImage(
                imageUrl: item.backdropUrl!,
                fit: BoxFit.cover,
              )
            else
              Container(color: AppColors.surface),

            // Gradient overlay
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, AppColors.background],
                  stops: [0.4, 1.0],
                ),
              ),
            ),

            // Title + buttons
            Positioned(
              left: AppSpacing.lg,
              right: AppSpacing.lg,
              bottom: AppSpacing.xl,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.textPrimary,
                          foregroundColor: AppColors.background,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.lg,
                            vertical: AppSpacing.sm,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                          ),
                        ),
                        icon: const Icon(Icons.play_arrow),
                        label: Text(
                          item.progress != null && item.progress! > 0
                              ? 'Reprendre'
                              : 'Lire',
                        ),
                        onPressed: () {
                          if ((item.progress ?? 0) > 0 &&
                              (item.currentTime ?? 0) > 0) {
                            _resumePlayback(context, item);
                            return;
                          }
                          _openDetail(context, item);
                        },
                      ),
                      const SizedBox(width: AppSpacing.md),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          side: const BorderSide(color: AppColors.textPrimary),
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.lg,
                            vertical: AppSpacing.sm,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(20),
                          ),
                        ),
                        icon: const Icon(Icons.info_outline),
                        label: const Text('Plus d\'infos'),
                        onPressed: () => _openDetail(context, item),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MediaRow extends StatefulWidget {
  final HomeRow row;
  const _MediaRow({required this.row});

  @override
  State<_MediaRow> createState() => _MediaRowState();
}

class _MediaRowState extends State<_MediaRow> {
  late final ScrollController _scrollController;
  bool _showLeftArrow = false;
  bool _showRightArrow = false;

  bool get _isContinueRow => widget.row.type == 'continue_watching';

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()..addListener(_updateArrowState);
    WidgetsBinding.instance.addPostFrameCallback((_) => _updateArrowState());
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_updateArrowState)
      ..dispose();
    super.dispose();
  }

  void _updateArrowState() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    final nextLeft = position.pixels > 12;
    final nextRight = position.pixels < position.maxScrollExtent - 12;
    if (nextLeft == _showLeftArrow && nextRight == _showRightArrow) return;
    setState(() {
      _showLeftArrow = nextLeft;
      _showRightArrow = nextRight;
    });
  }

  Future<void> _animateBy(double delta) async {
    if (!_scrollController.hasClients) return;
    final target = (_scrollController.offset + delta)
        .clamp(0.0, _scrollController.position.maxScrollExtent);
    await _scrollController.animateTo(
      target,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final row = widget.row;
    final rowHeight = _isContinueRow ? 170.0 : 196.0;
    final showArrows = MediaQuery.of(context).size.width >= 720;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
          child: Text(
            row.title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        SizedBox(
          height: rowHeight,
          child: Stack(
            children: [
              ListView.separated(
                controller: _scrollController,
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                itemCount: row.items.length,
                separatorBuilder: (_, __) =>
                    const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, i) {
                  final item = row.items[i];
                  return _isContinueRow
                      ? _ContinueTile(item: item)
                      : _PosterTile(item: item);
                },
              ),
              if (showArrows && _showLeftArrow)
                Positioned(
                  left: AppSpacing.sm,
                  top: 0,
                  bottom: 0,
                  child: _RowArrowButton(
                    icon: Icons.chevron_left,
                    onTap: () => _animateBy(-320),
                  ),
                ),
              if (showArrows && _showRightArrow)
                Positioned(
                  right: AppSpacing.sm,
                  top: 0,
                  bottom: 0,
                  child: _RowArrowButton(
                    icon: Icons.chevron_right,
                    onTap: () => _animateBy(320),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PosterTile extends StatelessWidget {
  final HomeItem item;
  const _PosterTile({required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _openDetail(context, item),
      child: SizedBox(
        width: 110,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.borderRadius),
          child: item.posterUrl != null
              ? CachedNetworkImage(
                  imageUrl: item.posterUrl!,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => Container(color: AppColors.surface),
                  errorWidget: (_, __, ___) =>
                      _PosterPlaceholder(title: item.title),
                )
              : _PosterPlaceholder(title: item.title),
        ),
      ),
    );
  }
}

class _PosterPlaceholder extends StatelessWidget {
  final String title;
  const _PosterPlaceholder({required this.title});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      child: Center(
        child: Text(
          title,
          textAlign: TextAlign.center,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
      ),
    );
  }
}

class _ContinueTile extends StatelessWidget {
  final HomeItem item;
  const _ContinueTile({required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _openDetail(context, item),
      child: SizedBox(
        width: 200,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.borderRadius),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (item.backdropUrl != null)
                      CachedNetworkImage(
                        imageUrl: item.backdropUrl!,
                        fit: BoxFit.cover,
                        placeholder: (_, __) =>
                            Container(color: AppColors.surface),
                      )
                    else
                      Container(color: AppColors.surface),
                    // Play button overlay
                    Center(
                      child: Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.36),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: 34,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Progress bar
            if (item.progress != null && item.progress! > 0)
              ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: item.progress!.clamp(0.0, 1.0),
                  backgroundColor: Colors.white24,
                  color: AppColors.primary,
                  minHeight: 3,
                ),
              ),
            const SizedBox(height: 4),
            Text(
              item.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _RowArrowButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _RowArrowButton({
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Material(
        color: Colors.black.withValues(alpha: 0.56),
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: SizedBox(
            width: 40,
            height: 40,
            child: Icon(icon, color: Colors.white),
          ),
        ),
      ),
    );
  }
}
// Home
