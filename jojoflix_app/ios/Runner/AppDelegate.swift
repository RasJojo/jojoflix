import AVFoundation
import Flutter
import MediaPlayer
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var playbackChannel: FlutterMethodChannel?
  private var remoteCommandsConfigured = false
  private var isPlaybackActive = false
  private var isPlaying = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    configureAudioSession()
    UIApplication.shared.beginReceivingRemoteControlEvents()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    let channel = FlutterMethodChannel(
      name: "jojoflix/native_playback",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
    )
    playbackChannel = channel
    channel.setMethodCallHandler(handlePlaybackMethodCall)
    configureRemoteCommandsIfNeeded()
  }

  private func handlePlaybackMethodCall(
    _ call: FlutterMethodCall,
    result: @escaping FlutterResult
  ) {
    switch call.method {
    case "updatePlayback":
      let args = call.arguments as? [String: Any] ?? [:]
      updatePlaybackState(args)
      result(nil)
    case "deactivatePlayback":
      deactivatePlaybackState()
      result(nil)
    case "setPictureInPictureEnabled", "enterPictureInPicture":
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
      try session.setActive(true)
    } catch {
      // Best effort: l'app reste lisible même si la session iOS refuse un mode.
    }
  }

  private func configureRemoteCommandsIfNeeded() {
    guard !remoteCommandsConfigured else { return }
    remoteCommandsConfigured = true

    let commandCenter = MPRemoteCommandCenter.shared()

    commandCenter.playCommand.isEnabled = true
    commandCenter.pauseCommand.isEnabled = true
    commandCenter.togglePlayPauseCommand.isEnabled = true
    commandCenter.skipForwardCommand.isEnabled = true
    commandCenter.skipBackwardCommand.isEnabled = true
    commandCenter.changePlaybackPositionCommand.isEnabled = true

    commandCenter.skipForwardCommand.preferredIntervals = [15]
    commandCenter.skipBackwardCommand.preferredIntervals = [15]

    commandCenter.playCommand.addTarget { [weak self] _ in
      self?.sendFlutterCommand(action: "play")
      return .success
    }
    commandCenter.pauseCommand.addTarget { [weak self] _ in
      self?.sendFlutterCommand(action: "pause")
      return .success
    }
    commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
      self?.sendFlutterCommand(action: "toggle")
      return .success
    }
    commandCenter.skipForwardCommand.addTarget { [weak self] _ in
      self?.sendFlutterCommand(action: "seekBy", deltaMs: 15_000)
      return .success
    }
    commandCenter.skipBackwardCommand.addTarget { [weak self] _ in
      self?.sendFlutterCommand(action: "seekBy", deltaMs: -15_000)
      return .success
    }
    commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else {
        return .commandFailed
      }
      self?.sendFlutterCommand(
        action: "seekTo",
        positionMs: Int(event.positionTime * 1000.0)
      )
      return .success
    }
  }

  private func updatePlaybackState(_ args: [String: Any]) {
    isPlaybackActive = args["active"] as? Bool ?? isPlaybackActive
    isPlaying = args["isPlaying"] as? Bool ?? isPlaying

    guard isPlaybackActive else {
      deactivatePlaybackState()
      return
    }

    let title = (args["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let subtitle = (args["subtitle"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let durationMs = (args["durationMs"] as? NSNumber)?.doubleValue ?? 0
    let positionMs = (args["positionMs"] as? NSNumber)?.doubleValue ?? 0

    var nowPlayingInfo: [String: Any] = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    nowPlayingInfo[MPMediaItemPropertyTitle] = (title?.isEmpty == false) ? title : "Jojoflix"
    if let subtitle, !subtitle.isEmpty {
      nowPlayingInfo[MPMediaItemPropertyArtist] = subtitle
    } else {
      nowPlayingInfo.removeValue(forKey: MPMediaItemPropertyArtist)
    }
    nowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000.0
    nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionMs / 1000.0
    nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlayingInfo

    do {
      try AVAudioSession.sharedInstance().setActive(true)
    } catch {
      // Best effort.
    }
  }

  private func deactivatePlaybackState() {
    isPlaybackActive = false
    isPlaying = false
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    } catch {
      // Best effort.
    }
  }

  private func sendFlutterCommand(
    action: String,
    deltaMs: Int? = nil,
    positionMs: Int? = nil
  ) {
    DispatchQueue.main.async { [weak self] in
      var arguments: [String: Any] = ["action": action]
      if let deltaMs {
        arguments["deltaMs"] = deltaMs
      }
      if let positionMs {
        arguments["positionMs"] = positionMs
      }
      self?.playbackChannel?.invokeMethod("command", arguments: arguments)
    }
  }
}
