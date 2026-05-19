import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';
import '../../home/repository/home_repository.dart';

part 'browse_screen.g.dart';

@riverpod
Future<List<HomeRow>> browseRows(Ref ref, String mediaType) async {
  final dio = ref.watch(apiClientProvider).dio;
  final response = await dio.get('/api/browse/$mediaType');
  final data = response.data['data']['rows'] as List;
  return data.map((r) => HomeRow.fromJson(r as Map<String, dynamic>)).toList();
}

class BrowseScreen extends ConsumerWidget {
  final String mediaType;
  const BrowseScreen({super.key, required this.mediaType});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rowsAsync = ref.watch(browseRowsProvider(mediaType));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: rowsAsync.when(
        loading: () => const JojoflixLoader(),
        error: (e, _) => _ErrorRetry(
          onRetry: () => ref.invalidate(browseRowsProvider(mediaType)),
        ),
        data: (rows) => _BrowseContent(rows: rows, mediaType: mediaType),
      ),
    );
  }
}

class _ErrorRetry extends StatelessWidget {
  final VoidCallback onRetry;
  const _ErrorRetry({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Impossible de charger le contenu',
              style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.md),
          ElevatedButton(onPressed: onRetry, child: const Text('Réessayer')),
        ],
      ),
    );
  }
}

class _BrowseContent extends StatelessWidget {
  final List<HomeRow> rows;
  final String mediaType;
  const _BrowseContent({required this.rows, required this.mediaType});

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const Center(
        child: Text('Aucun contenu disponible',
            style: TextStyle(color: AppColors.textSecondary)),
      );
    }

    // Le premier item du premier row sert de hero
    final heroItem = rows.first.items.isNotEmpty ? rows.first.items.first : null;

    return CustomScrollView(
      slivers: [
        if (heroItem != null)
          SliverToBoxAdapter(
            child: _BrowseHero(item: heroItem, mediaType: mediaType),
          ),
        for (final row in rows)
          SliverToBoxAdapter(child: _BrowseRow(row: row)),
        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
      ],
    );
  }
}

// ── Hero ──────────────────────────────────────────────────────────────────────

class _BrowseHero extends StatelessWidget {
  final HomeItem item;
  final String mediaType;
  const _BrowseHero({required this.item, required this.mediaType});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push('/detail/${item.mediaType}/${item.tmdbId}'),
      child: SizedBox(
        height: 420,
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

            // Top vignette
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.center,
                  colors: [Color(0x88000000), Colors.transparent],
                ),
              ),
            ),

            // Bottom fade
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.center,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, AppColors.background],
                  stops: [0.5, 1.0],
                ),
              ),
            ),

            // Label + titre + bouton
            Positioned(
              left: AppSpacing.lg,
              right: AppSpacing.lg,
              bottom: AppSpacing.xl,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      mediaType == 'movie' ? 'FILM TENDANCE' : 'SÉRIE TENDANCE',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    item.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      shadows: [
                        Shadow(
                            color: Colors.black54,
                            offset: Offset(0, 2),
                            blurRadius: 8)
                      ],
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg,
                          vertical: AppSpacing.sm + 2),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(6)),
                      elevation: 0,
                    ),
                    icon: const Icon(Icons.info_outline_rounded, size: 20),
                    label: const Text('Plus d\'infos',
                        style: TextStyle(
                            fontWeight: FontWeight.w700, fontSize: 14)),
                    onPressed: () => context
                        .push('/detail/${item.mediaType}/${item.tmdbId}'),
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

// ── Rows ──────────────────────────────────────────────────────────────────────

class _BrowseRow extends StatefulWidget {
  final HomeRow row;
  const _BrowseRow({required this.row});

  @override
  State<_BrowseRow> createState() => _BrowseRowState();
}

class _BrowseRowState extends State<_BrowseRow> {
  late final ScrollController _scrollController;
  bool _showLeftArrow = false;
  bool _showRightArrow = false;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController()..addListener(_updateArrows);
    WidgetsBinding.instance.addPostFrameCallback((_) => _updateArrows());
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_updateArrows)
      ..dispose();
    super.dispose();
  }

  void _updateArrows() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    final left = pos.pixels > 12;
    final right = pos.pixels < pos.maxScrollExtent - 12;
    if (left == _showLeftArrow && right == _showRightArrow) return;
    setState(() {
      _showLeftArrow = left;
      _showRightArrow = right;
    });
  }

  Future<void> _animateBy(double delta) async {
    if (!_scrollController.hasClients) return;
    await _scrollController.animateTo(
      (_scrollController.offset + delta)
          .clamp(0.0, _scrollController.position.maxScrollExtent),
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    final showArrows = MediaQuery.of(context).size.width >= 720;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.sm),
          child: Text(
            widget.row.title,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        SizedBox(
          height: 196,
          child: Stack(
            children: [
              ListView.separated(
                controller: _scrollController,
                scrollDirection: Axis.horizontal,
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                itemCount: widget.row.items.length,
                separatorBuilder: (_, __) =>
                    const SizedBox(width: AppSpacing.sm),
                itemBuilder: (context, i) =>
                    _BrowseTile(item: widget.row.items[i]),
              ),
              if (showArrows && _showLeftArrow)
                Positioned(
                  left: AppSpacing.sm,
                  top: 0,
                  bottom: 0,
                  child: _ArrowButton(
                      icon: Icons.chevron_left,
                      onTap: () => _animateBy(-320)),
                ),
              if (showArrows && _showRightArrow)
                Positioned(
                  right: AppSpacing.sm,
                  top: 0,
                  bottom: 0,
                  child: _ArrowButton(
                      icon: Icons.chevron_right,
                      onTap: () => _animateBy(320)),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BrowseTile extends StatefulWidget {
  final HomeItem item;
  const _BrowseTile({required this.item});

  @override
  State<_BrowseTile> createState() => _BrowseTileState();
}

class _BrowseTileState extends State<_BrowseTile> {
  bool _hovered = false;
  bool _focused = false;
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
  }

  void _onFocusChange() {
    final focused = _focusNode.hasFocus;
    setState(() => _focused = focused);
    if (focused) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _focusNode.hasFocus) {
          Scrollable.ensureVisible(context,
              alignment: 0.5,
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOut);
        }
      });
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    super.dispose();
  }

  void _activate() => context
      .push('/detail/${widget.item.mediaType}/${widget.item.tmdbId}');

  @override
  Widget build(BuildContext context) {
    final highlighted = _hovered || _focused;
    return Focus(
      focusNode: _focusNode,
      onKeyEvent: (_, event) {
        if (event is KeyDownEvent &&
            (event.logicalKey == LogicalKeyboardKey.select ||
                event.logicalKey == LogicalKeyboardKey.enter)) {
          _activate();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      onFocusChange: (_) {},
      child: MouseRegion(
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: _activate,
          child: AnimatedScale(
            scale: highlighted ? 1.06 : 1.0,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppTheme.borderRadius),
                boxShadow: _focused
                    ? [
                        BoxShadow(
                          color: Colors.white.withValues(alpha: 0.6),
                          blurRadius: 0,
                          spreadRadius: 2,
                        )
                      ]
                    : null,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.borderRadius),
                child: SizedBox(
                  width: 110,
                  child: widget.item.posterUrl != null
                      ? CachedNetworkImage(
                          imageUrl: widget.item.posterUrl!,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: AppColors.surface),
                          errorWidget: (_, __, ___) =>
                              _Placeholder(title: widget.item.title),
                        )
                      : _Placeholder(title: widget.item.title),
                ),
              ),
            ),
          ),
        ),
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
        child: Text(
          title,
          textAlign: TextAlign.center,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style:
              const TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
      ),
    );
  }
}

class _ArrowButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _ArrowButton({required this.icon, required this.onTap});

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
