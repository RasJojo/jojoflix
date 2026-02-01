// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'detail_screen.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

String _$mediaDetailHash() => r'17c89af5bbe0c7cddac9efe00989344d0ab484b9';

/// Copied from Dart SDK
class _SystemHash {
  _SystemHash._();

  static int combine(int hash, int value) {
    // ignore: parameter_assignments
    hash = 0x1fffffff & (hash + value);
    // ignore: parameter_assignments
    hash = 0x1fffffff & (hash + ((0x0007ffff & hash) << 10));
    return hash ^ (hash >> 6);
  }

  static int finish(int hash) {
    // ignore: parameter_assignments
    hash = 0x1fffffff & (hash + ((0x03ffffff & hash) << 3));
    // ignore: parameter_assignments
    hash = hash ^ (hash >> 11);
    return 0x1fffffff & (hash + ((0x00003fff & hash) << 15));
  }
}

/// See also [mediaDetail].
@ProviderFor(mediaDetail)
const mediaDetailProvider = MediaDetailFamily();

/// See also [mediaDetail].
class MediaDetailFamily extends Family<AsyncValue<MediaDetail>> {
  /// See also [mediaDetail].
  const MediaDetailFamily();

  /// See also [mediaDetail].
  MediaDetailProvider call(
    String tmdbId,
    String mediaType,
  ) {
    return MediaDetailProvider(
      tmdbId,
      mediaType,
    );
  }

  @override
  MediaDetailProvider getProviderOverride(
    covariant MediaDetailProvider provider,
  ) {
    return call(
      provider.tmdbId,
      provider.mediaType,
    );
  }

  static const Iterable<ProviderOrFamily>? _dependencies = null;

  @override
  Iterable<ProviderOrFamily>? get dependencies => _dependencies;

  static const Iterable<ProviderOrFamily>? _allTransitiveDependencies = null;

  @override
  Iterable<ProviderOrFamily>? get allTransitiveDependencies =>
      _allTransitiveDependencies;

  @override
  String? get name => r'mediaDetailProvider';
}

/// See also [mediaDetail].
class MediaDetailProvider extends AutoDisposeFutureProvider<MediaDetail> {
  /// See also [mediaDetail].
  MediaDetailProvider(
    String tmdbId,
    String mediaType,
  ) : this._internal(
          (ref) => mediaDetail(
            ref as MediaDetailRef,
            tmdbId,
            mediaType,
          ),
          from: mediaDetailProvider,
          name: r'mediaDetailProvider',
          debugGetCreateSourceHash:
              const bool.fromEnvironment('dart.vm.product')
                  ? null
                  : _$mediaDetailHash,
          dependencies: MediaDetailFamily._dependencies,
          allTransitiveDependencies:
              MediaDetailFamily._allTransitiveDependencies,
          tmdbId: tmdbId,
          mediaType: mediaType,
        );

  MediaDetailProvider._internal(
    super._createNotifier, {
    required super.name,
    required super.dependencies,
    required super.allTransitiveDependencies,
    required super.debugGetCreateSourceHash,
    required super.from,
    required this.tmdbId,
    required this.mediaType,
  }) : super.internal();

  final String tmdbId;
  final String mediaType;

  @override
  Override overrideWith(
    FutureOr<MediaDetail> Function(MediaDetailRef provider) create,
  ) {
    return ProviderOverride(
      origin: this,
      override: MediaDetailProvider._internal(
        (ref) => create(ref as MediaDetailRef),
        from: from,
        name: null,
        dependencies: null,
        allTransitiveDependencies: null,
        debugGetCreateSourceHash: null,
        tmdbId: tmdbId,
        mediaType: mediaType,
      ),
    );
  }

  @override
  AutoDisposeFutureProviderElement<MediaDetail> createElement() {
    return _MediaDetailProviderElement(this);
  }

  @override
  bool operator ==(Object other) {
    return other is MediaDetailProvider &&
        other.tmdbId == tmdbId &&
        other.mediaType == mediaType;
  }

  @override
  int get hashCode {
    var hash = _SystemHash.combine(0, runtimeType.hashCode);
    hash = _SystemHash.combine(hash, tmdbId.hashCode);
    hash = _SystemHash.combine(hash, mediaType.hashCode);

    return _SystemHash.finish(hash);
  }
}

@Deprecated('Will be removed in 3.0. Use Ref instead')
// ignore: unused_element
mixin MediaDetailRef on AutoDisposeFutureProviderRef<MediaDetail> {
  /// The parameter `tmdbId` of this provider.
  String get tmdbId;

  /// The parameter `mediaType` of this provider.
  String get mediaType;
}

class _MediaDetailProviderElement
    extends AutoDisposeFutureProviderElement<MediaDetail> with MediaDetailRef {
  _MediaDetailProviderElement(super.provider);

  @override
  String get tmdbId => (origin as MediaDetailProvider).tmdbId;
  @override
  String get mediaType => (origin as MediaDetailProvider).mediaType;
}

String _$watchProgressHash() => r'ee760cff21474c4875f15e0224874aa55817b807';

/// See also [watchProgress].
@ProviderFor(watchProgress)
const watchProgressProvider = WatchProgressFamily();

/// See also [watchProgress].
class WatchProgressFamily extends Family<AsyncValue<WatchProgress?>> {
  /// See also [watchProgress].
  const WatchProgressFamily();

  /// See also [watchProgress].
  WatchProgressProvider call(
    String tmdbId,
    String mediaType,
  ) {
    return WatchProgressProvider(
      tmdbId,
      mediaType,
    );
  }

  @override
  WatchProgressProvider getProviderOverride(
    covariant WatchProgressProvider provider,
  ) {
    return call(
      provider.tmdbId,
      provider.mediaType,
    );
  }

  static const Iterable<ProviderOrFamily>? _dependencies = null;

  @override
  Iterable<ProviderOrFamily>? get dependencies => _dependencies;

  static const Iterable<ProviderOrFamily>? _allTransitiveDependencies = null;

  @override
  Iterable<ProviderOrFamily>? get allTransitiveDependencies =>
      _allTransitiveDependencies;

  @override
  String? get name => r'watchProgressProvider';
}

/// See also [watchProgress].
class WatchProgressProvider extends AutoDisposeFutureProvider<WatchProgress?> {
  /// See also [watchProgress].
  WatchProgressProvider(
    String tmdbId,
    String mediaType,
  ) : this._internal(
          (ref) => watchProgress(
            ref as WatchProgressRef,
            tmdbId,
            mediaType,
          ),
          from: watchProgressProvider,
          name: r'watchProgressProvider',
          debugGetCreateSourceHash:
              const bool.fromEnvironment('dart.vm.product')
                  ? null
                  : _$watchProgressHash,
          dependencies: WatchProgressFamily._dependencies,
          allTransitiveDependencies:
              WatchProgressFamily._allTransitiveDependencies,
          tmdbId: tmdbId,
          mediaType: mediaType,
        );

  WatchProgressProvider._internal(
    super._createNotifier, {
    required super.name,
    required super.dependencies,
    required super.allTransitiveDependencies,
    required super.debugGetCreateSourceHash,
    required super.from,
    required this.tmdbId,
    required this.mediaType,
  }) : super.internal();

  final String tmdbId;
  final String mediaType;

  @override
  Override overrideWith(
    FutureOr<WatchProgress?> Function(WatchProgressRef provider) create,
  ) {
    return ProviderOverride(
      origin: this,
      override: WatchProgressProvider._internal(
        (ref) => create(ref as WatchProgressRef),
        from: from,
        name: null,
        dependencies: null,
        allTransitiveDependencies: null,
        debugGetCreateSourceHash: null,
        tmdbId: tmdbId,
        mediaType: mediaType,
      ),
    );
  }

  @override
  AutoDisposeFutureProviderElement<WatchProgress?> createElement() {
    return _WatchProgressProviderElement(this);
  }

  @override
  bool operator ==(Object other) {
    return other is WatchProgressProvider &&
        other.tmdbId == tmdbId &&
        other.mediaType == mediaType;
  }

  @override
  int get hashCode {
    var hash = _SystemHash.combine(0, runtimeType.hashCode);
    hash = _SystemHash.combine(hash, tmdbId.hashCode);
    hash = _SystemHash.combine(hash, mediaType.hashCode);

    return _SystemHash.finish(hash);
  }
}

@Deprecated('Will be removed in 3.0. Use Ref instead')
// ignore: unused_element
mixin WatchProgressRef on AutoDisposeFutureProviderRef<WatchProgress?> {
  /// The parameter `tmdbId` of this provider.
  String get tmdbId;

  /// The parameter `mediaType` of this provider.
  String get mediaType;
}

class _WatchProgressProviderElement
    extends AutoDisposeFutureProviderElement<WatchProgress?>
    with WatchProgressRef {
  _WatchProgressProviderElement(super.provider);

  @override
  String get tmdbId => (origin as WatchProgressProvider).tmdbId;
  @override
  String get mediaType => (origin as WatchProgressProvider).mediaType;
}
// ignore_for_file: type=lint
// ignore_for_file: subtype_of_sealed_class, invalid_use_of_internal_member, invalid_use_of_visible_for_testing_member, deprecated_member_use_from_same_package
