import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';
import '../../home/widget/home_screen.dart';
import '../repository/profile_repository.dart';
import '../repository/watchlist_repository.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  late Future<_ProfilePageData> _pageFuture;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _pageFuture = _loadPageData();
  }

  Future<_ProfilePageData> _loadPageData() async {
    final profileRepo = ref.read(profileRepositoryProvider);
    final watchlistRepo = ref.read(watchlistRepositoryProvider);
    final prefs = ref.read(sharedPreferencesProvider);
    final activeProfileId =
        int.tryParse(prefs.getString('active_profile_id') ?? '');
    final profiles = await profileRepo.getProfiles();

    if (activeProfileId == null || activeProfileId <= 0) {
      return _ProfilePageData(
        profiles: profiles,
        activeProfileId: null,
        watchlist: const [],
      );
    }

    final watchlist = await watchlistRepo.getWatchlist(activeProfileId);
    return _ProfilePageData(
      profiles: profiles,
      activeProfileId: activeProfileId,
      watchlist: watchlist,
    );
  }

  Future<void> _switchProfile(int profileId) async {
    await ref.read(profileRepositoryProvider).selectProfile(profileId);
    ref.invalidate(homeRowsProvider);
    if (!mounted) return;
    setState(_reload);
  }

  Future<void> _removeFromWatchlist(WatchlistItem item) async {
    final activeProfileId = int.tryParse(
      ref.read(sharedPreferencesProvider).getString('active_profile_id') ?? '',
    );
    if (activeProfileId == null || activeProfileId <= 0) return;

    await ref
        .read(watchlistRepositoryProvider)
        .remove(activeProfileId, item.tmdbId, item.mediaType);
    ref.invalidate(homeRowsProvider);
    if (!mounted) return;
    setState(_reload);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: FutureBuilder<_ProfilePageData>(
        future: _pageFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const JojoflixLoader();
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return ErrorRetryWidget(
              message: 'Impossible de charger le profil',
              onRetry: () => setState(_reload),
            );
          }

          final data = snapshot.data!;
          final activeProfile = data.activeProfile;

          return CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.xl,
                    AppSpacing.lg,
                    AppSpacing.lg,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Profil',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (activeProfile == null)
                        OutlinedButton.icon(
                          onPressed: () => context.go('/profiles/select'),
                          icon: const Icon(Icons.person_search),
                          label: const Text('Choisir un profil'),
                        )
                      else
                        _ActiveProfileCard(
                          profile: activeProfile,
                          onChangeProfile: () => context.go('/profiles/select'),
                        ),
                      const SizedBox(height: AppSpacing.lg),
                      const Text(
                        'Changer rapidement',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      SizedBox(
                        height: 112,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: data.profiles.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(width: AppSpacing.sm),
                          itemBuilder: (context, index) {
                            final profile = data.profiles[index];
                            final isSelected =
                                profile.id == data.activeProfileId;
                            return _QuickProfileTile(
                              profile: profile,
                              isSelected: isSelected,
                              onTap: isSelected
                                  ? null
                                  : () => _switchProfile(profile.id),
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xl),
                      const Text(
                        'Ma liste',
                        style: TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (data.watchlist.isEmpty)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                    child: Text(
                      'Ajoute des films et séries depuis leur page détail pour les retrouver ici.',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 14,
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.sm,
                    AppSpacing.lg,
                    AppSpacing.xxl,
                  ),
                  sliver: SliverGrid(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final item = data.watchlist[index];
                        return _WatchlistCard(
                          item: item,
                          onRemove: () => _removeFromWatchlist(item),
                        );
                      },
                      childCount: data.watchlist.length,
                    ),
                    gridDelegate:
                        const SliverGridDelegateWithMaxCrossAxisExtent(
                      maxCrossAxisExtent: 180,
                      mainAxisSpacing: AppSpacing.md,
                      crossAxisSpacing: AppSpacing.md,
                      childAspectRatio: 0.62,
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _ProfilePageData {
  final List<ProfileModel> profiles;
  final int? activeProfileId;
  final List<WatchlistItem> watchlist;

  const _ProfilePageData({
    required this.profiles,
    required this.activeProfileId,
    required this.watchlist,
  });

  ProfileModel? get activeProfile {
    for (final profile in profiles) {
      if (profile.id == activeProfileId) return profile;
    }
    return null;
  }
}

class _ActiveProfileCard extends StatelessWidget {
  final ProfileModel profile;
  final VoidCallback onChangeProfile;

  const _ActiveProfileCard({
    required this.profile,
    required this.onChangeProfile,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: profile.avatarUrl != null
                ? CachedNetworkImage(
                    imageUrl: profile.avatarUrl!,
                    width: 72,
                    height: 72,
                    fit: BoxFit.cover,
                  )
                : Container(
                    width: 72,
                    height: 72,
                    color: AppColors.surfaceVariant,
                    child: Center(
                      child: Text(
                        profile.name[0].toUpperCase(),
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  profile.isKids ? 'Profil enfant' : 'Profil standard',
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          OutlinedButton(
            onPressed: onChangeProfile,
            child: const Text('Changer'),
          ),
        ],
      ),
    );
  }
}

class _QuickProfileTile extends StatelessWidget {
  final ProfileModel profile;
  final bool isSelected;
  final VoidCallback? onTap;

  const _QuickProfileTile({
    required this.profile,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: onTap,
      child: Container(
        width: 96,
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.surfaceVariant : AppColors.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.primary : Colors.transparent,
            width: 1.5,
          ),
        ),
        child: Column(
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: profile.avatarUrl != null
                    ? CachedNetworkImage(
                        imageUrl: profile.avatarUrl!,
                        width: double.infinity,
                        fit: BoxFit.cover,
                      )
                    : Container(
                        color: AppColors.background,
                        child: Center(
                          child: Text(
                            profile.name[0].toUpperCase(),
                            style: const TextStyle(
                              color: AppColors.textPrimary,
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              profile.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WatchlistCard extends StatelessWidget {
  final WatchlistItem item;
  final VoidCallback onRemove;

  const _WatchlistCard({
    required this.item,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => context.push('/detail/${item.mediaType}/${item.tmdbId}'),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius:
                        const BorderRadius.vertical(top: Radius.circular(20)),
                    child: item.posterUrl != null
                        ? CachedNetworkImage(
                            imageUrl: item.posterUrl!,
                            fit: BoxFit.cover,
                          )
                        : Container(color: AppColors.surfaceVariant),
                  ),
                  Positioned(
                    top: AppSpacing.xs,
                    right: AppSpacing.xs,
                    child: Material(
                      color: Colors.black54,
                      borderRadius: BorderRadius.circular(999),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(999),
                        onTap: onRemove,
                        child: const Padding(
                          padding: EdgeInsets.all(6),
                          child: Icon(
                            Icons.close,
                            color: Colors.white,
                            size: 16,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: Text(
                item.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
// Profile
