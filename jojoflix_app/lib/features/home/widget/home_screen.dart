import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

    final heroItems = rows.isNotEmpty && rows.first.items.isNotEmpty
        ? rows.first.items.take(5).toList()
        : <HomeItem>[];

    return CustomScrollView(
      slivers: [
        if (heroItems.isNotEmpty)
          SliverToBoxAdapter(child: _RotatingHeroBanner(items: heroItems)),

        for (final row in rows)
          SliverToBoxAdapter(child: _MediaRow(row: row)),

        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xl)),
      ],
    );
  }
}

// ── Hero rotatif ─────────────────────────────────────────────────────────────

class _RotatingHeroBanner extends StatefulWidget {
  final List<HomeItem> items;
  const _RotatingHeroBanner({required this.items});

  @override
  State<_RotatingHeroBanner> createState() => _RotatingHeroBannerState();
}

class _RotatingHeroBannerState extends State<_RotatingHeroBanner> {
  int _current = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.items.length > 1) {
      _timer = Timer.periodic(const Duration(seconds: 7), (_) {
        if (!mounted) return;
        setState(() => _current = (_current + 1) % widget.items.length);
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 520,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Crossfade between hero items
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 700),
            child: _HeroBannerContent(
              key: ValueKey(_current),
              item: widget.items[_current],
            ),
          ),

          // Dots
          if (widget.items.length > 1)
            Positioned(
              bottom: AppSpacing.lg,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (int i = 0; i < widget.items.length; i++)
                    GestureDetector(
                      onTap: () => setState(() => _current = i),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.symmetric(
                            horizontal: 3, vertical: 0),
                        width: i == _current ? 20 : 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: i == _current
                              ? Colors.white
                              : Colors.white.withValues(alpha: 0.35),
                          borderRadius: BorderRadius.circular(3),
                        ),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _HeroBannerContent extends StatelessWidget {
  final HomeItem item;
  const _HeroBannerContent({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _openDetail(context, item),
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Backdrop
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

          // Bottom gradient → background
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

          // Title + buttons
          Positioned(
            left: AppSpacing.lg,
            right: AppSpacing.lg,
            bottom: AppSpacing.xxl + AppSpacing.lg,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 32,
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
                Row(
                  children: [
                    _HeroButton(
                      label: (item.progress != null && item.progress! > 0)
                          ? 'Reprendre'
                          : 'Lire',
                      icon: Icons.play_arrow_rounded,
                      filled: true,
                      onPressed: () {
                        if ((item.progress ?? 0) > 0 &&
                            (item.currentTime ?? 0) > 0) {
                          _resumePlayback(context, item);
                        } else {
                          _openDetail(context, item);
                        }
                      },
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    _HeroButton(
                      label: 'Plus d\'infos',
                      icon: Icons.info_outline_rounded,
                      filled: false,
                      onPressed: () => _openDetail(context, item),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool filled;
  final VoidCallback onPressed;

  const _HeroButton({
    required this.label,
    required this.icon,
    required this.filled,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    if (filled) {
      return ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.white,
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.sm + 2),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
          elevation: 0,
        ),
        icon: Icon(icon, size: 22),
        label: Text(label,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
        onPressed: onPressed,
      );
    }
    return ElevatedButton.icon(
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.white.withValues(alpha: 0.2),
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg, vertical: AppSpacing.sm + 2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        elevation: 0,
      ),
      icon: Icon(icon, size: 22),
      label: Text(label,
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
      onPressed: onPressed,
    );
  }
}

// ── Media rows ────────────────────────────────────────────────────────────────

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
    await _scrollController.animateTo(
      (_scrollController.offset + delta)
          .clamp(0.0, _scrollController.position.maxScrollExtent),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
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

// ── Tiles ─────────────────────────────────────────────────────────────────────

class _PosterTile extends StatefulWidget {
  final HomeItem item;
  const _PosterTile({required this.item});

  @override
  State<_PosterTile> createState() => _PosterTileState();
}

class _PosterTileState extends State<_PosterTile> {
  bool _hovered = false;
  bool _focused = false;
  final _focusNode = FocusNode();

  void _activate(BuildContext context) =>
      _openDetail(context, widget.item);

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

  @override
  Widget build(BuildContext context) {
    final highlighted = _hovered || _focused;
    return Focus(
      focusNode: _focusNode,
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent &&
            (event.logicalKey == LogicalKeyboardKey.select ||
                event.logicalKey == LogicalKeyboardKey.enter)) {
          _activate(context);
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
          onTap: () => _activate(context),
          child: AnimatedScale(
            scale: highlighted ? 1.06 : 1.0,
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              decoration: BoxDecoration(
                borderRadius:
                    BorderRadius.circular(AppTheme.borderRadius),
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
                borderRadius:
                    BorderRadius.circular(AppTheme.borderRadius),
                child: SizedBox(
                  width: 110,
                  child: widget.item.posterUrl != null
                      ? CachedNetworkImage(
                          imageUrl: widget.item.posterUrl!,
                          fit: BoxFit.cover,
                          placeholder: (_, __) =>
                              Container(color: AppColors.surface),
                          errorWidget: (_, __, ___) =>
                              _PosterPlaceholder(title: widget.item.title),
                        )
                      : _PosterPlaceholder(title: widget.item.title),
                ),
              ),
            ),
          ),
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
          style:
              const TextStyle(color: AppColors.textSecondary, fontSize: 11),
        ),
      ),
    );
  }
}

class _ContinueTile extends StatefulWidget {
  final HomeItem item;
  const _ContinueTile({required this.item});

  @override
  State<_ContinueTile> createState() => _ContinueTileState();
}

class _ContinueTileState extends State<_ContinueTile> {
  bool _hovered = false;
  bool _focused = false;
  final _focusNode = FocusNode();

  void _activate(BuildContext context) =>
      _openDetail(context, widget.item);

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

  @override
  Widget build(BuildContext context) {
    final highlighted = _hovered || _focused;
    return Focus(
      focusNode: _focusNode,
      onKeyEvent: (node, event) {
        if (event is KeyDownEvent &&
            (event.logicalKey == LogicalKeyboardKey.select ||
                event.logicalKey == LogicalKeyboardKey.enter)) {
          _activate(context);
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
        onTap: () => _activate(context),
        child: AnimatedScale(
          scale: highlighted ? 1.04 : 1.0,
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          child: SizedBox(
            width: 200,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: ClipRRect(
                    borderRadius:
                        BorderRadius.circular(AppTheme.borderRadius),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (widget.item.backdropUrl != null)
                          CachedNetworkImage(
                            imageUrl: widget.item.backdropUrl!,
                            fit: BoxFit.cover,
                            placeholder: (_, __) =>
                                Container(color: AppColors.surface),
                          )
                        else
                          Container(color: AppColors.surface),
                        Center(
                          child: AnimatedOpacity(
                            opacity: _hovered ? 1.0 : 0.7,
                            duration: const Duration(milliseconds: 150),
                            child: Container(
                              width: 52,
                              height: 52,
                              decoration: BoxDecoration(
                                color: Colors.black.withValues(alpha: 0.5),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.play_arrow_rounded,
                                color: Colors.white,
                                size: 34,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (widget.item.progress != null &&
                    widget.item.progress! > 0)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: widget.item.progress!.clamp(0.0, 1.0),
                      backgroundColor: Colors.white24,
                      color: AppColors.primary,
                      minHeight: 3,
                    ),
                  ),
                const SizedBox(height: 4),
                Text(
                  widget.item.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    ),  // closes Focus
    );
  }
}

class _RowArrowButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;

  const _RowArrowButton({required this.icon, required this.onTap});

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
