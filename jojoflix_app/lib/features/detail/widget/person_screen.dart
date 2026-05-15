import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../repository/person_repository.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widget/jojoflix_loader.dart';

class PersonScreen extends ConsumerWidget {
  final int personId;

  const PersonScreen({super.key, required this.personId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(personDetailProvider(personId));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: detailAsync.when(
        loading: () => const JojoflixLoader(),
        error: (_, __) => ErrorRetryWidget(
          message: 'Impossible de charger la page acteur',
          onRetry: () => ref.invalidate(personDetailProvider(personId)),
        ),
        data: (person) {
          return CustomScrollView(
            slivers: [
              SliverAppBar(
                pinned: true,
                backgroundColor: AppColors.background,
                leading: IconButton(
                  icon: const Icon(Icons.arrow_back, color: Colors.white),
                  onPressed: () {
                    if (context.canPop()) {
                      context.pop();
                    } else {
                      context.go('/home');
                    }
                  },
                ),
                title: Text(
                  person.name,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Photo portrait
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: SizedBox(
                          width: 120,
                          height: 180,
                          child: person.profileUrl != null
                              ? CachedNetworkImage(
                                  imageUrl: person.profileUrl!,
                                  fit: BoxFit.cover,
                                  width: 120,
                                  height: 180,
                                )
                              : Container(
                                  color: AppColors.surface,
                                  child: const Icon(
                                    Icons.person,
                                    color: AppColors.textSecondary,
                                    size: 48,
                                  ),
                                ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      // Infos à droite
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              person.name,
                              style: const TextStyle(
                                color: AppColors.textPrimary,
                                fontSize: 22,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: AppSpacing.sm),
                            Wrap(
                              spacing: AppSpacing.xs,
                              runSpacing: AppSpacing.xs,
                              children: [
                                if ((person.knownForDepartment ?? '').isNotEmpty)
                                  _InfoChip(label: person.knownForDepartment!),
                                if ((person.birthday ?? '').isNotEmpty)
                                  _InfoChip(label: person.birthday!),
                                if ((person.placeOfBirth ?? '').isNotEmpty)
                                  _InfoChip(label: person.placeOfBirth!),
                              ],
                            ),
                            if ((person.biography ?? '').trim().isNotEmpty) ...[
                              const SizedBox(height: AppSpacing.sm),
                              Text(
                                person.biography!,
                                maxLines: 7,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 13,
                                  height: 1.45,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.xs,
                    AppSpacing.lg,
                    AppSpacing.md,
                  ),
                  child: const Text(
                    'Filmographie',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  0,
                  AppSpacing.lg,
                  AppSpacing.xxl,
                ),
                sliver: SliverGrid(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => _PersonCreditCard(
                      credit: person.credits[index],
                    ),
                    childCount: person.credits.length,
                  ),
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 180,
                    mainAxisSpacing: AppSpacing.md,
                    crossAxisSpacing: AppSpacing.md,
                    childAspectRatio: 0.58,
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

class _PersonCreditCard extends StatelessWidget {
  final PersonCredit credit;

  const _PersonCreditCard({required this.credit});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => context.push('/detail/${credit.mediaType}/${credit.tmdbId}'),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(20)),
                child: credit.posterUrl != null
                    ? CachedNetworkImage(
                        imageUrl: credit.posterUrl!,
                        fit: BoxFit.cover,
                        width: double.infinity,
                      )
                    : Container(color: AppColors.surfaceVariant),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    credit.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if ((credit.character ?? '').trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      credit.character!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                  if ((credit.releaseDate ?? '').trim().isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      credit.releaseDate!.split('-').first,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final String label;

  const _InfoChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
