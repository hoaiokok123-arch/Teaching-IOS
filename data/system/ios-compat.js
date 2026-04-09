(function (window, document, $) {
  "use strict";

  if (!window.tyrano || !window.tyrano.plugin || !window.tyrano.plugin.kag || !$) {
    return;
  }

  var compat = window.__TF_IOS_COMPAT || {};

  compat.pendingGestureCallbacks = [];
  compat.gestureListenersBound = false;
  compat.audioUnlocked = false;

  compat.isIOS = function () {
    var ua = window.navigator.userAgent || "";
    var platform = window.navigator.platform || "";
    var maxTouchPoints = window.navigator.maxTouchPoints || 0;

    return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  };

  compat.isTouchDevice = function () {
    var ua = window.navigator.userAgent || "";
    return compat.isIOS() || /Android/i.test(ua);
  };

  compat.isBrowserRuntime = function () {
    return !($.isNWJS && $.isNWJS());
  };

  compat.normalizeAudioStorage = function (storage) {
    if (!storage) {
      return storage;
    }

    if (compat.isIOS()) {
      return storage.replace(/\.ogg$/i, ".m4a");
    }

    return storage;
  };

  compat.normalizeVideoStorage = function (storage) {
    if (!storage) {
      return storage;
    }

    if (compat.isIOS()) {
      return storage.replace(/\.webm$/i, ".mp4");
    }

    return storage;
  };

  compat.ensureGestureListeners = function () {
    var events;
    var handler;

    if (compat.gestureListenersBound) {
      return;
    }

    compat.gestureListenersBound = true;
    events = ["pointerdown", "touchend", "click"];

    handler = function () {
      var callbacks = compat.pendingGestureCallbacks.splice(0);
      var kag = window.TYRANO && window.TYRANO.kag ? window.TYRANO.kag : null;
      var i;

      compat.audioUnlocked = true;

      if (kag && kag.tmp && kag.tmp.ready_audio === false) {
        kag.readyAudio();
        kag.tmp.ready_audio = true;
      }

      for (i = 0; i < callbacks.length; i++) {
        try {
          callbacks[i]();
        } catch (error) {
          if (window.console && console.error) {
            console.error(error);
          }
        }
      }
    };

    events.forEach(function (eventName) {
      document.addEventListener(eventName, handler, true);
    });
  };

  compat.requestUserGesture = function (callback) {
    compat.ensureGestureListeners();
    compat.pendingGestureCallbacks.push(callback);
  };

  compat.playMediaElement = function (mediaElement, onRejected) {
    var playResult;

    try {
      playResult = mediaElement.play();
    } catch (error) {
      if (onRejected) {
        onRejected(error);
      }
      return;
    }

    if (playResult && typeof playResult.then === "function") {
      playResult.catch(function (error) {
        if (onRejected) {
          onRejected(error);
        }
      });
    }
  };

  compat.buildMediaUrl = function (folderName, storage) {
    if ($.isHTTP(storage)) {
      return storage;
    }

    if (!storage) {
      return "";
    }

    return "./data/" + folderName + "/" + storage;
  };

  compat.deferMediaUntilGesture = function (context, retryPlayback) {
    context.kag.layer.showEventLayer();
    compat.requestUserGesture(function () {
      context.kag.layer.hideEventLayer();
      retryPlayback();
    });
  };

  compat.resolveAudioVolume = function (context, pm, targetName) {
    var volume = 1;

    if (pm.volume !== "") {
      volume = parseFloat(parseInt(pm.volume, 10) / 100);
    } else if (targetName === "bgm") {
      if (typeof context.kag.config.defaultBgmVolume === "undefined") {
        volume = 1;
      } else {
        volume = parseFloat(parseInt(context.kag.config.defaultBgmVolume, 10) / 100);
      }

      if (typeof context.kag.stat.map_bgm_volume[pm.buf] !== "undefined") {
        volume = parseFloat(parseInt(context.kag.stat.map_bgm_volume[pm.buf], 10) / 100);
      }
    } else {
      if (typeof context.kag.config.defaultSeVolume === "undefined") {
        volume = 1;
      } else {
        volume = parseFloat(parseInt(context.kag.config.defaultSeVolume, 10) / 100);
      }

      if (typeof context.kag.stat.map_se_volume[pm.buf] !== "undefined") {
        volume = parseFloat(parseInt(context.kag.stat.map_se_volume[pm.buf], 10) / 100);
      }
    }

    return volume;
  };

  compat.applyAudioLoopMode = function (audioObject, pm) {
    if (pm.loop === "true") {
      audioObject.loop = true;
      audioObject.onended = function () {
        this.play();
      };
      return;
    }

    if (pm.loop === "smooth") {
      var audioInterval = setInterval(function () {
        var remainingTime = audioObject.duration - audioObject.currentTime;
        if (remainingTime < 0.1) {
          audioObject.currentTime = 0;
          compat.playMediaElement(audioObject);
        }
      }, 30);

      $(audioObject).on("pause", function () {
        clearInterval(audioInterval);
      });
      return;
    }

    audioObject.loop = false;
    audioObject.onended = function () {};
  };

  compat.attachAudioEndedHandler = function (context, pm, targetName, audioObject, isNewAudio) {
    if (!isNewAudio) {
      return;
    }

    audioObject.addEventListener("ended", function () {
      if (pm.target === "se") {
        context.kag.tmp.is_se_play = false;
        context.kag.tmp.is_vo_play = false;

        if (context.kag.tmp.is_se_play_wait === true) {
          context.kag.tmp.is_se_play_wait = false;
          context.kag.ftag.nextOrder();
        } else if (context.kag.tmp.is_vo_play_wait === true) {
          context.kag.tmp.is_vo_play_wait = false;
          setTimeout(function () {
            context.kag.ftag.nextOrder();
          }, 500);
        }
      } else if (targetName === "bgm") {
        context.kag.tmp.is_bgm_play = false;

        if (context.kag.tmp.is_bgm_play_wait === true) {
          context.kag.tmp.is_bgm_play_wait = false;
          context.kag.ftag.nextOrder();
        }
      }
    });
  };

  compat.ensureFadeIn = function (audioObject, volume, pm, context) {
    if (pm.fadein !== "true") {
      return;
    }

    var vars = jQuery.extend($("<div>")[0], { volume: 0 });

    $(vars).stop().animate(
      { volume: volume },
      {
        easing: "linear",
        duration: parseInt(pm.time, 10),
        step: function () {
          if (context.kag.tmp.is_audio_stopping === false || pm.target === "se") {
            audioObject.volume = this.volume;
          }
        }
      }
    );
  };

  (function patchUserEnv() {
    var originalUserEnv = $.userenv;

    $.userenv = function () {
      if (compat.isIOS()) {
        return "iphone";
      }

      return originalUserEnv.apply(this, arguments);
    };
  })();

  (function patchStorageFallback() {
    var originalSetStorage = $.setStorage;
    var originalGetStorage = $.getStorage;

    $.setStorage = function (key, val, type) {
      if (type === "file" && compat.isBrowserRuntime()) {
        type = "webstorage_compress";
      }

      return originalSetStorage.call(this, key, val, type);
    };

    $.getStorage = function (key, type) {
      if (type === "file" && compat.isBrowserRuntime()) {
        type = "webstorage_compress";
      }

      return originalGetStorage.call(this, key, type);
    };
  })();

  (function patchKagInit() {
    var originalInitGame = window.tyrano.plugin.kag.init_game;

    window.tyrano.plugin.kag.init_game = function () {
      originalInitGame.apply(this, arguments);

      if (compat.isBrowserRuntime() && this.config.configSave === "file") {
        this.config.configSave = "webstorage_compress";
      }
    };
  })();

  (function patchAudioTag() {
    var audioTag = window.tyrano.plugin.kag.tag.playbgm;
    var originalStart = audioTag.start;

    audioTag.start = function (pm) {
      var that = this;

      if (pm.target === "bgm" && that.kag.stat.play_bgm === false) {
        that.kag.ftag.nextOrder();
        return;
      }

      if (pm.target === "se" && that.kag.stat.play_se === false) {
        that.kag.ftag.nextOrder();
        return;
      }

      if (that.kag.define.FLAG_APRI === true) {
        that.playGap(pm);
        return;
      }

      if ($.userenv() !== "pc") {
        this.kag.layer.hideEventLayer();

        if (this.kag.stat.is_skip === true && pm.target === "se") {
          that.kag.layer.showEventLayer();
          that.kag.ftag.nextOrder();
          return;
        }

        if (pm.click === "true") {
          compat.requestUserGesture(function () {
            that.play(pm);
            $(".tyrano_base").unbind("click.bgm");
            that.kag.layer.showEventLayer();
          });
          return;
        }

        that.play(pm);
        return;
      }

      originalStart.call(this, pm);
    };

    audioTag.play = function (pm) {
      var that = this;
      var targetName = pm.target === "se" ? "sound" : "bgm";
      var storage = pm.storage;
      var volume;
      var storageUrl;
      var audioObject = null;
      var isNewAudio = false;

      if (pm.target === "se") {
        targetName = "sound";
        this.kag.tmp.is_se_play = true;

        if (this.kag.stat.map_vo.vobuf[pm.buf]) {
          this.kag.tmp.is_vo_play = true;
        }
      } else {
        this.kag.tmp.is_audio_stopping = false;
        this.kag.tmp.is_bgm_play = true;
      }

      volume = compat.resolveAudioVolume(this, pm, targetName === "sound" ? "se" : "bgm");

      if (compat.isIOS()) {
        storage = compat.normalizeAudioStorage(storage);
      } else if (this.kag.config.mediaFormatDefault !== "mp3") {
        var browser = $.getBrowser();
        if (browser === "msie" || browser === "safari" || browser === "edge") {
          storage = $.replaceAll(storage, ".ogg", ".m4a");
        }
      }

      storageUrl = compat.buildMediaUrl(targetName, storage);

      if (targetName === "bgm") {
        if (this.kag.tmp.map_bgm[pm.buf] != null) {
          audioObject = this.kag.tmp.map_bgm[pm.buf];
          audioObject.src = storageUrl;
        } else {
          audioObject = new Audio(storageUrl);
          isNewAudio = true;
        }
      } else {
        if (this.kag.tmp.map_se[pm.buf] != null) {
          audioObject = this.kag.tmp.map_se[pm.buf];
          audioObject.src = storageUrl;
        } else {
          audioObject = new Audio(storageUrl);
          isNewAudio = true;
        }
      }

      audioObject.volume = volume;

      if (!storageUrl) {
        if (targetName === "bgm") {
          this.kag.tmp.map_bgm[pm.buf] = audioObject;
        } else {
          this.kag.tmp.map_se[pm.buf] = audioObject;
        }

        this.kag.layer.showEventLayer();
        return;
      }

      compat.applyAudioLoopMode(audioObject, pm);

      if (targetName === "bgm") {
        this.kag.tmp.map_bgm[pm.buf] = audioObject;
        that.kag.stat.current_bgm = storage;
      } else {
        if (this.kag.tmp.map_se[pm.buf] != null) {
          this.kag.tmp.map_se[pm.buf].pause();
          this.kag.tmp.map_se[pm.buf] = null;
        }

        this.kag.tmp.map_se[pm.buf] = audioObject;
      }

      $(audioObject).off("play");
      $(audioObject).on("play", function () {
        compat.audioUnlocked = true;
        that.kag.tmp.ready_audio = true;
        that.kag.layer.showEventLayer();

        if (pm.stop === "false") {
          that.kag.ftag.nextOrder();
        }
      });

      compat.playMediaElement(audioObject, function () {
        compat.deferMediaUntilGesture(that, function () {
          compat.playMediaElement(audioObject, function () {
            that.kag.layer.showEventLayer();
          });
        });
      });

      compat.ensureFadeIn(audioObject, volume, pm, that);
      compat.attachAudioEndedHandler(that, pm, targetName, audioObject, isNewAudio);
    };
  })();

  (function patchMovieTag() {
    var movieTag = window.tyrano.plugin.kag.tag.movie;
    var originalStart = movieTag.start;

    movieTag.start = function (pm) {
      if ($.userenv() !== "pc") {
        this.kag.layer.showEventLayer();
        this.playVideo(pm);
        return;
      }

      originalStart.call(this, pm);
    };

    movieTag.playVideo = function (pm) {
      var that = this;
      var storage = pm.storage;
      var url;
      var video = document.createElement("video");
      var jVideo;

      if (compat.isIOS()) {
        storage = compat.normalizeVideoStorage(storage);
      }

      url = "./data/video/" + storage;

      video.id = "bgmovie";
      video.src = url;
      video.style.backgroundColor = "black";
      video.style.position = "absolute";
      video.style.top = "0px";
      video.style.left = "0px";
      video.style.width = "100%";
      video.style.height = "100%";
      video.autoplay = true;
      video.autobuffer = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");

      if (pm.volume !== "") {
        video.volume = parseFloat(parseInt(pm.volume, 10) / 100);
      } else if (typeof this.kag.config.defaultMovieVolume !== "undefined") {
        video.volume = parseFloat(parseInt(this.kag.config.defaultMovieVolume, 10) / 100);
      }

      if (pm.bgmode === "true") {
        that.kag.tmp.video_playing = true;
        video.style.zIndex = 0;
        video.loop = pm.loop === "true";
        video.addEventListener("ended", function onVideoEnded() {
          if (that.kag.stat.video_stack == null) {
            that.kag.tmp.video_playing = false;
            if (that.kag.stat.is_wait_bgmovie === true) {
              that.kag.ftag.nextOrder();
              that.kag.stat.is_wait_bgmovie = false;
            }
          } else {
            var videoPm = that.kag.stat.video_stack;
            var nextStorage = compat.isIOS() ? compat.normalizeVideoStorage(videoPm.storage) : videoPm.storage;
            var video2 = document.createElement("video");
            var jVideo2 = $(video2);

            video2.style.backgroundColor = "black";
            video2.style.position = "absolute";
            video2.style.top = "0px";
            video2.style.left = "0px";
            video2.style.width = "100%";
            video2.style.height = "100%";
            video2.autoplay = true;
            video2.autobuffer = true;
            video2.loop = videoPm.loop === "true";
            video2.setAttribute("playsinline", "true");
            video2.setAttribute("webkit-playsinline", "true");
            video2.src = "./data/video/" + nextStorage;
            video2.load();

            compat.playMediaElement(video2, function () {
              compat.deferMediaUntilGesture(that, function () {
                compat.playMediaElement(video2);
              });
            });

            jVideo2.css("z-index", -1);
            $("#tyrano_base").append(jVideo2);

            video2.addEventListener(
              "canplay",
              function onCanPlay() {
                jVideo2.css("z-index", 1);
                setTimeout(function () {
                  $("#bgmovie").remove();
                  video2.id = "bgmovie";
                }, 100);
                that.kag.stat.video_stack = null;
                that.kag.ftag.nextOrder();
                that.kag.tmp.video_playing = true;
                video2.removeEventListener("canplay", onCanPlay, false);
              },
              false
            );

            video2.addEventListener("ended", onVideoEnded);
          }
        });
      } else {
        video.style.zIndex = 199999;
        video.addEventListener("ended", function () {
          $(".tyrano_base").find("video").remove();
          that.kag.ftag.nextOrder();
        });

        if (pm.skip === "true") {
          video.addEventListener("click", function () {
            $(".tyrano_base").find("video").remove();
            that.kag.ftag.nextOrder();
          });
        }
      }

      jVideo = $(video);
      jVideo.css("opacity", 0);
      $("#tyrano_base").append(jVideo);
      jVideo.animate(
        { opacity: "1" },
        {
          duration: parseInt(pm.time, 10),
          complete: function () {}
        }
      );

      video.load();
      compat.playMediaElement(video, function () {
        compat.deferMediaUntilGesture(that, function () {
          compat.playMediaElement(video, function () {
            that.kag.layer.showEventLayer();
          });
        });
      });
    };
  })();

  (function patchBlendMovieTag() {
    var blendMovieTag = window.tyrano.plugin.kag.tag.layermode_movie;
    var originalStart = blendMovieTag.start;

    blendMovieTag.start = function (pm) {
      if (compat.isIOS() && pm.video) {
        pm = $.extend(true, {}, pm);
        pm.video = compat.normalizeVideoStorage(pm.video);
      }

      originalStart.call(this, pm);
    };
  })();

  compat.ensureGestureListeners();
  window.__TF_IOS_COMPAT = compat;
})(window, document, window.jQuery);
