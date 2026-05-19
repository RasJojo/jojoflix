// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'browse_screen.dart';

// **************************************************************************
// RiverpodGenerator
// **************************************************************************

String _$browseRowsHash() => r'08141e76f963a0800f88da7644d3f27dc16a9784';

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

/// See also [browseRows].
@ProviderFor(browseRows)
const browseRowsProvider = BrowseRowsFamily();

/// See also [browseRows].
class BrowseRowsFamily extends Family<AsyncValue<List<HomeRow>>> {
  /// See also [browseRows].
  const BrowseRowsFamily();

  /// See also [browseRows].
  BrowseRowsProvider call(
    String mediaType,
  ) {
    return BrowseRowsProvider(
      mediaType,
    );
  }

  @override
  BrowseRowsProvider getProviderOverride(
    covariant BrowseRowsProvider provider,
  ) {
    return call(
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
  String? get name => r'browseRowsProvider';
}

/// See also [browseRows].
class BrowseRowsProvider extends AutoDisposeFutureProvider<List<HomeRow>> {
  /// See also [browseRows].
  BrowseRowsProvider(
    String mediaType,
  ) : this._internal(
          (ref) => browseRows(
            ref as BrowseRowsRef,
            mediaType,
          ),
          from: browseRowsProvider,
          name: r'browseRowsProvider',
          debugGetCreateSourceHash:
              const bool.fromEnvironment('dart.vm.product')
                  ? null
                  : _$browseRowsHash,
          dependencies: BrowseRowsFamily._dependencies,
          allTransitiveDependencies:
              BrowseRowsFamily._allTransitiveDependencies,
          mediaType: mediaType,
        );

  BrowseRowsProvider._internal(
    super._createNotifier, {
    required super.name,
    required super.dependencies,
    required super.allTransitiveDependencies,
    required super.debugGetCreateSourceHash,
    required super.from,
    required this.mediaType,
  }) : super.internal();

  final String mediaType;

  @override
  Override overrideWith(
    FutureOr<List<HomeRow>> Function(BrowseRowsRef provider) create,
  ) {
    return ProviderOverride(
      origin: this,
      override: BrowseRowsProvider._internal(
        (ref) => create(ref as BrowseRowsRef),
        from: from,
        name: null,
        dependencies: null,
        allTransitiveDependencies: null,
        debugGetCreateSourceHash: null,
        mediaType: mediaType,
      ),
    );
  }

  @override
  AutoDisposeFutureProviderElement<List<HomeRow>> createElement() {
    return _BrowseRowsProviderElement(this);
  }

  @override
  bool operator ==(Object other) {
    return other is BrowseRowsProvider && other.mediaType == mediaType;
  }

  @override
  int get hashCode {
    var hash = _SystemHash.combine(0, runtimeType.hashCode);
    hash = _SystemHash.combine(hash, mediaType.hashCode);

    return _SystemHash.finish(hash);
  }
}

@Deprecated('Will be removed in 3.0. Use Ref instead')
// ignore: unused_element
mixin BrowseRowsRef on AutoDisposeFutureProviderRef<List<HomeRow>> {
  /// The parameter `mediaType` of this provider.
  String get mediaType;
}

class _BrowseRowsProviderElement
    extends AutoDisposeFutureProviderElement<List<HomeRow>> with BrowseRowsRef {
  _BrowseRowsProviderElement(super.provider);

  @override
  String get mediaType => (origin as BrowseRowsProvider).mediaType;
}
// ignore_for_file: type=lint
// ignore_for_file: subtype_of_sealed_class, invalid_use_of_internal_member, invalid_use_of_visible_for_testing_member, deprecated_member_use_from_same_package
