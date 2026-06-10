import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme/app_theme.dart';
import 'download_manager.dart';

class DownloadsScreen extends ConsumerWidget {
  const DownloadsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dlState = ref.watch(downloadManagerProvider);
    final active = dlState.activeTasks.values.toList();
    final completed = dlState.completedDownloads.reversed.toList();
    final groupedSeries = _groupSeriesDownloads(completed);
    final movies = completed.where((item) => item.mediaType != 'tv').toList();

    if (active.isEmpty && completed.isEmpty) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: const Text('Téléchargements',
              style: TextStyle(color: AppColors.textPrimary)),
          backgroundColor: AppColors.background,
        ),
        body: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.download_outlined,
                  size: 64, color: AppColors.textSecondary),
              SizedBox(height: 16),
              Text(
                'Aucun téléchargement',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16),
              ),
              SizedBox(height: 8),
              Text(
                'Appuie sur ↓ sur un épisode ou un film pour le télécharger.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
              ),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Téléchargements',
            style: TextStyle(color: AppColors.textPrimary)),
        backgroundColor: AppColors.background,
      ),
      body: ListView(
        children: [
          if (active.isNotEmpty) ...[
            const _SectionHeader(label: 'En cours'),
            for (final task in active) _ActiveTaskTile(task: task),
          ],
          if (completed.isNotEmpty) ...[
            const _SectionHeader(label: 'Téléchargés'),
            for (final item in movies) _CompletedItemTile(item: item),
            for (final group in groupedSeries)
              _SeriesDownloadGroup(group: group),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  List<_SeriesGroup> _groupSeriesDownloads(List<DownloadedItem> items) {
    final bySeries = <String, List<DownloadedItem>>{};
    for (final item in items.where((item) => item.mediaType == 'tv')) {
      bySeries.putIfAbsent(item.tmdbId, () => []).add(item);
    }
    final groups = bySeries.entries.map((entry) {
      final episodes = [...entry.value]..sort((a, b) {
          final seasonCompare = (a.season ?? 0).compareTo(b.season ?? 0);
          if (seasonCompare != 0) return seasonCompare;
          return (a.episode ?? 0).compareTo(b.episode ?? 0);
        });
      return _SeriesGroup(
        tmdbId: entry.key,
        title: episodes.first.title,
        artworkUrl: episodes.first.artworkUrl,
        episodes: episodes,
      );
    }).toList();
    groups.sort((a, b) => a.title.compareTo(b.title));
    return groups;
  }
}

class _SeriesGroup {
  final String tmdbId;
  final String title;
  final String? artworkUrl;
  final List<DownloadedItem> episodes;

  const _SeriesGroup({
    required this.tmdbId,
    required this.title,
    required this.artworkUrl,
    required this.episodes,
  });
}

class _SectionHeader extends StatelessWidget {
  final String label;
  const _SectionHeader({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        label,
        style: const TextStyle(
          color: AppColors.textSecondary,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 1,
        ),
      ),
    );
  }
}

class _ActiveTaskTile extends ConsumerWidget {
  final DownloadTask task;
  const _ActiveTaskTile({required this.task});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isError = task.status == DownloadTaskStatus.error;

    return ListTile(
      leading: SizedBox(
        width: 36,
        height: 36,
        child: isError
            ? const Icon(Icons.error_outline, color: AppColors.primary)
            : Stack(
                alignment: Alignment.center,
                children: [
                  CircularProgressIndicator(
                    value: task.progress > 0 ? task.progress : null,
                    color: AppColors.primary,
                    strokeWidth: 3,
                    backgroundColor: AppColors.surfaceVariant,
                  ),
                  if (task.progress > 0)
                    Text(
                      '${(task.progress * 100).round()}',
                      style: const TextStyle(
                          color: AppColors.textPrimary, fontSize: 9),
                    ),
                ],
              ),
      ),
      title: Text(
        task.label ?? task.id.replaceAll('_', ' '),
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
      ),
      subtitle: Text(
        isError ? (task.error ?? 'Erreur') : _statusLabel(task),
        style: TextStyle(
          color: isError ? AppColors.primary : AppColors.textSecondary,
          fontSize: 12,
        ),
      ),
      trailing: isError
          ? IconButton(
              icon: const Icon(Icons.close, color: AppColors.textSecondary),
              onPressed: () => ref
                  .read(downloadManagerProvider.notifier)
                  .dismissError(task.id),
            )
          : IconButton(
              icon: const Icon(Icons.cancel_outlined,
                  color: AppColors.textSecondary),
              onPressed: () => ref
                  .read(downloadManagerProvider.notifier)
                  .cancelDownload(task.id),
            ),
    );
  }

  String _statusLabel(DownloadTask task) {
    return switch (task.status) {
      DownloadTaskStatus.queued => 'Préparation…',
      DownloadTaskStatus.downloading => task.progress > 0
          ? '${(task.progress * 100).toStringAsFixed(0)}%'
          : 'Téléchargement…',
      DownloadTaskStatus.error => task.error ?? 'Erreur',
    };
  }
}

class _SeriesDownloadGroup extends StatelessWidget {
  final _SeriesGroup group;
  const _SeriesDownloadGroup({required this.group});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: SizedBox(
        width: 42,
        height: 42,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: group.artworkUrl != null
              ? Image.network(group.artworkUrl!, fit: BoxFit.cover)
              : Container(
                  color: AppColors.surface,
                  child: const Icon(Icons.tv_outlined,
                      color: AppColors.textSecondary, size: 20),
                ),
        ),
      ),
      collapsedIconColor: AppColors.textSecondary,
      iconColor: AppColors.textPrimary,
      title: Text(
        group.title,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 15),
      ),
      subtitle: Text(
        '${group.episodes.length} épisode${group.episodes.length > 1 ? 's' : ''}',
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
      ),
      children: [
        for (final item in group.episodes)
          Padding(
            padding: const EdgeInsets.only(left: 18),
            child: _CompletedItemTile(item: item),
          ),
      ],
    );
  }
}

class _CompletedItemTile extends ConsumerWidget {
  final DownloadedItem item;
  const _CompletedItemTile({required this.item});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      leading: SizedBox(
        width: 36,
        height: 36,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: item.artworkUrl != null
              ? Image.network(item.artworkUrl!, fit: BoxFit.cover)
              : Container(
                  color: AppColors.surface,
                  child: const Icon(Icons.movie_outlined,
                      color: AppColors.textSecondary, size: 20),
                ),
        ),
      ),
      title: Text(
        item.episodeLabel != null
            ? '${item.title} · ${item.episodeLabel}'
            : item.title,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        _meta(),
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
      ),
      onTap: () => _playOffline(context),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon:
                const Icon(Icons.play_circle_outline, color: AppColors.primary),
            onPressed: () => _playOffline(context),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline,
                color: AppColors.textSecondary),
            onPressed: () => _confirmDelete(context, ref),
          ),
        ],
      ),
    );
  }

  String _meta() {
    final parts = <String>[];
    if (item.sizeGb != null) parts.add('${item.sizeGb!.toStringAsFixed(1)} Go');
    if (item.subtitles.isNotEmpty) {
      parts.add(
          '${item.subtitles.length} sous-titre${item.subtitles.length > 1 ? 's' : ''}');
    }
    return parts.join(' · ');
  }

  void _playOffline(BuildContext context) {
    context.push(
      '/player/${item.mediaType}/${item.tmdbId}',
      extra: {
        'localVideoPath': item.videoPath,
        'localSubtitles': item.subtitles
            .map((s) => {
                  'language': s.language,
                  'displayName': s.displayName,
                  'path': s.path,
                })
            .toList(),
        'season': item.season,
        'episode': item.episode,
        'title': item.title,
        'subtitle': item.episodeLabel,
        'artworkUrl': item.artworkUrl,
        'profileId': 0,
        'startPosition': 0,
      },
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Supprimer',
            style: TextStyle(color: AppColors.textPrimary)),
        content: Text(
          'Supprimer "${item.episodeLabel ?? item.title}" de vos téléchargements ?',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Annuler',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Supprimer',
                style: TextStyle(color: AppColors.primary)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(downloadManagerProvider.notifier).deleteDownload(item.id);
    }
  }
}
