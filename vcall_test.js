/*
function onSuccess(stream) {
    var video_1 = document.getElementById('webcam_1');
    var video_2 = document.getElementById('webcam_2');
    try {
        video_1.src = URL.createObjectURL(stream);
        video_2.src = URL.createObjectURL(stream);
    }
	catch(e) {
        video_1.srcObject = stream;
        video_2.srcObject = stream;
    }

    video_1.autoplay = true; 
    video_2.autoplay = true; 
    // 或者 video.play();
}

function onError(error) {
  console.log("navigator.getUserMedia error: ", error);
}


// use button to control Media
$(document).ready(function(){
    $("#start").click(function(){
        $(this).attr('disabled', true).unbind('click');
        if (navigator.getUserMedia) {
            navigator.getUserMedia({video:true, audio:true}, onSuccess, onError);
        } else {
            console.log("Ah.. No cam found, use fungible mp4 instead..");
            document.getElementById('webcam').src = 'somevideo.mp4';
        }
    });

  });
*/

// variables
var janus_server = "http://39.105.1.45:8088/janus";
var janus = null;
var echotest = null;
var opaqueId = "echotest-"+Janus.randomString(12);

var bitrateTimer = null;
var spinner = null;

var audioenabled = false;
var videoenabled = false;

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");
var doSimulcast2 = (getQueryStringValue("simulcast2") === "yes" || getQueryStringValue("simulcast2") === "true");
var acodec = (getQueryStringValue("acodec") !== "" ? getQueryStringValue("acodec") : null);
var vcodec = (getQueryStringValue("vcodec") !== "" ? getQueryStringValue("vcodec") : null);
var simulcastStarted = false;

var one_off_limit_flag = false;
var init_bitrate = 88*1000;

$(document).ready(function() {
	// Initialize the library (all console debuggers enabled)
	Janus.init({debug: "all", callback: function() {
		// Use a button to start the demo
		$('#start').one('click', function() {
			$(this).attr('disabled', true).unbind('click');
			// Make sure the browser supports WebRTC
			if(!Janus.isWebrtcSupported()) {
				window.alert("No WebRTC support... ");
				return;
            }
            else{
                toastr.info("Good WebRTC support");
            }
            // Create session
            janus = new Janus(
				{
					server: janus_server,
					success: function() {
						// Attach to VideoCall plugin
						janus.attach(
							{
								plugin: "janus.plugin.videocall",
								opaqueId: opaqueId,
								success: function(pluginHandle) {
									$('#details').remove();
									videocall = pluginHandle;
									Janus.log("Plugin attached! (" + videocall.getPlugin() + ", id=" + videocall.getId() + ")");
									// Prepare the username registration
									$('#videocall').removeClass('hide').show();
									$('#login').removeClass('hide').show();
									$('#registernow').removeClass('hide').show();
									$('#register').click(registerUsername);
									$('#username').focus();
									$('#start').removeAttr('disabled').html("Stop")
										.click(function() {
											$(this).attr('disabled', true);
											janus.destroy();
										});
								},
								error: function(error) {
									Janus.error("  -- Error attaching plugin...", error);
									bootbox.alert("  -- Error attaching plugin... " + error);
								},
								consentDialog: function(on) {
									Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
									if(on) {
										// Darken screen and show hint
										$.blockUI({
											message: '<div><img src="up_arrow.png"/></div>',
											css: {
												border: 'none',
												padding: '15px',
												backgroundColor: 'transparent',
												color: '#aaa',
												top: '10px',
												left: (navigator.mozGetUserMedia ? '-100px' : '300px')
											} });
									} else {
										// Restore screen
										$.unblockUI();
									}
								},
								mediaState: function(medium, on) {
									Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
								},
								webrtcState: function(on) {
									Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
									$("#videoleft").parent().unblock();
								},
								onmessage: function(msg, jsep) {
									Janus.debug(" ::: Got a message :::");
									Janus.debug(msg);
									var result = msg["result"];
									if(result !== null && result !== undefined) {
										if(result["list"] !== undefined && result["list"] !== null) {
											var list = result["list"];
											Janus.debug("Got a list of registered peers:");
											Janus.debug(list);
											for(var mp in list) {
												Janus.debug("  >> [" + list[mp] + "]");
											}
										} else if(result["event"] !== undefined && result["event"] !== null) {
											var event = result["event"];
											if(event === 'registered') {
												myusername = result["username"];
												Janus.log("Successfully registered as " + myusername + "!");
												$('#youok').removeClass('hide').show().html("Registered as '" + myusername + "'");
												// Get a list of available peers, just for fun
												videocall.send({"message": { "request": "list" }});
												// TODO Enable buttons to call now
												$('#phone').removeClass('hide').show();
												$('#call').unbind('click').click(doCall);
												$('#peer').focus();
											} else if(event === 'calling') {
												Janus.log("Waiting for the peer to answer...");
												// TODO Any ringtone?
												bootbox.alert("Waiting for the peer to answer...");
											} else if(event === 'incomingcall') {
												Janus.log("Incoming call from " + result["username"] + "!");
												yourusername = result["username"];
												// Notify user
												bootbox.hideAll();
												incoming = bootbox.dialog({
													message: "Incoming call from " + yourusername + "!",
													title: "Incoming call",
													closeButton: false,
													buttons: {
														success: {
															label: "Answer",
															className: "btn-success",
															callback: function() {
																incoming = null;
																$('#peer').val(result["username"]).attr('disabled', true);
																videocall.createAnswer(
																	{
																		jsep: jsep,
																		// No media provided: by default, it's sendrecv for audio and video
																		media: { data: true },	// Let's negotiate data channels as well
																		// If you want to test simulcasting (Chrome and Firefox only), then
																		// pass a ?simulcast=true when opening this demo page: it will turn
																		// the following 'simulcast' property to pass to janus.js to true
																		simulcast: doSimulcast,
																		success: function(jsep) {
																			Janus.debug("Got SDP!");
																			Janus.debug(jsep);
																			var body = { "request": "accept" };
																			videocall.send({"message": body, "jsep": jsep});
																			$('#peer').attr('disabled', true);
																			$('#call').removeAttr('disabled').html('Hangup')
																				.removeClass("btn-success").addClass("btn-danger")
																				.unbind('click').click(doHangup);
																		},
																		error: function(error) {
																			Janus.error("WebRTC error:", error);
																			bootbox.alert("WebRTC error... " + JSON.stringify(error));
																		}
																	});
															}
														},
														danger: {
															label: "Decline",
															className: "btn-danger",
															callback: function() {
																doHangup();
															}
														}
													}
												});
											} else if(event === 'accepted') {
												bootbox.hideAll();
												var peer = result["username"];
												if(peer === null || peer === undefined) {
													Janus.log("Call started!");
												} else {
													Janus.log(peer + " accepted the call!");
													yourusername = peer;
												}
												// Video call can start
												if(jsep)
													videocall.handleRemoteJsep({jsep: jsep});
												$('#call').removeAttr('disabled').html('Hangup')
													.removeClass("btn-success").addClass("btn-danger")
													.unbind('click').click(doHangup);
											} else if(event === 'update') {
												// An 'update' event may be used to provide renegotiation attempts
												if(jsep) {
													if(jsep.type === "answer") {
														videocall.handleRemoteJsep({jsep: jsep});
													} else {
														videocall.createAnswer(
															{
																jsep: jsep,
																media: { data: true },	// Let's negotiate data channels as well
																success: function(jsep) {
																	Janus.debug("Got SDP!");
																	Janus.debug(jsep);
																	var body = { "request": "set" };
																	videocall.send({"message": body, "jsep": jsep});
																},
																error: function(error) {
																	Janus.error("WebRTC error:", error);
																	bootbox.alert("WebRTC error... " + JSON.stringify(error));
																}
															});
													}
												}
											} else if(event === 'hangup') {
												Janus.log("Call hung up by " + result["username"] + " (" + result["reason"] + ")!");
												// Reset status
												bootbox.hideAll();
												videocall.hangup();
												if(spinner !== null && spinner !== undefined)
													spinner.stop();
												$('#waitingvideo').remove();
												$('#videos').hide();
												$('#peer').removeAttr('disabled').val('');
												$('#call').removeAttr('disabled').html('Call')
													.removeClass("btn-danger").addClass("btn-success")
													.unbind('click').click(doCall);
												$('#toggleaudio').attr('disabled', true);
												$('#togglevideo').attr('disabled', true);
												$('#bitrate').attr('disabled', true);
												$('#curbitrate').hide();
												$('#curres').hide();
											} else if(event === "simulcast") {
												// Is simulcast in place?
												var substream = result["substream"];
												var temporal = result["temporal"];
												if((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
													if(!simulcastStarted) {
														simulcastStarted = true;
														addSimulcastButtons(result["videocodec"] === "vp8" || result["videocodec"] === "h264");
													}
													// We just received notice that there's been a switch, update the buttons
													updateSimulcastButtons(substream, temporal);
												}
											}
										}
									} else {
										// FIXME Error?
										var error = msg["error"];
										bootbox.alert(error);
										if(error.indexOf("already taken") > 0) {
											// FIXME Use status codes...
											$('#username').removeAttr('disabled').val("");
											$('#register').removeAttr('disabled').unbind('click').click(registerUsername);
										}
										// TODO Reset status
										videocall.hangup();
										if(spinner !== null && spinner !== undefined)
											spinner.stop();
										$('#waitingvideo').remove();
										$('#videos').hide();
										$('#peer').removeAttr('disabled').val('');
										$('#call').removeAttr('disabled').html('Call')
											.removeClass("btn-danger").addClass("btn-success")
											.unbind('click').click(doCall);
										$('#toggleaudio').attr('disabled', true);
										$('#togglevideo').attr('disabled', true);
										$('#bitrate').attr('disabled', true);
										$('#curbitrate').hide();
										$('#curres').hide();
										if(bitrateTimer !== null && bitrateTimer !== null)
											clearInterval(bitrateTimer);
										bitrateTimer = null;
									}
								},
								onlocalstream: function(stream) {
									Janus.debug(" ::: Got a local stream :::");
									Janus.debug(stream);
									$('#videos').removeClass('hide').show();
									if($('#myvideo').length === 0)
										$('#videoleft').append('<video class="rounded centered" id="myvideo" width=640 height=480 autoplay playsinline muted="muted"/>');
									Janus.attachMediaStream($('#myvideo').get(0), stream);
									$("#myvideo").get(0).muted = "muted";
									if(videocall.webrtcStuff.pc.iceConnectionState !== "completed" &&
											videocall.webrtcStuff.pc.iceConnectionState !== "connected") {
										$("#videoleft").parent().block({
											message: '<b>Publishing...</b>',
											css: {
												border: 'none',
												backgroundColor: 'transparent',
												color: 'white'
											}
										});
										// No remote video yet
										$('#videoright').append('<video class="rounded centered" id="waitingvideo" width=640 height=480 />');
										if(spinner == null) {
											var target = document.getElementById('videoright');
											spinner = new Spinner({top:100}).spin(target);
										} else {
											spinner.spin();
										}
									}
									var videoTracks = stream.getVideoTracks();
									if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
										// No webcam
										$('#myvideo').hide();
										if($('#videoleft .no-video-container').length === 0) {
											$('#videoleft').append(
												'<div class="no-video-container">' +
													'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
													'<span class="no-video-text">No webcam available</span>' +
												'</div>');
										}
									} else {
										$('#videoleft .no-video-container').remove();
										$('#myvideo').removeClass('hide').show();
									}
								},
								onremotestream: function(stream) {
									Janus.debug(" ::: Got a remote stream :::");
									Janus.debug(stream);
									var addButtons = false;
									if($('#remotevideo').length === 0) {
										addButtons = true;
										$('#videoright').append('<video class="rounded centered hide" id="remotevideo" width=640 height=480 autoplay playsinline/>');
										// Show the video, hide the spinner and show the resolution when we get a playing event
										$("#remotevideo").bind("playing", function () {
											$('#waitingvideo').remove();
											if(this.videoWidth)
												$('#remotevideo').removeClass('hide').show();
											if(spinner !== null && spinner !== undefined)
												spinner.stop();
											spinner = null;
											var width = this.videoWidth;
											var height = this.videoHeight;
											$('#curres').removeClass('hide').text(width+'x'+height).show();
										});
										$('#callee').removeClass('hide').html(yourusername).show();
									}
									Janus.attachMediaStream($('#remotevideo').get(0), stream);
									var videoTracks = stream.getVideoTracks();
									if(videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
										// No remote video
										$('#remotevideo').hide();
										if($('#videoright .no-video-container').length === 0) {
											$('#videoright').append(
												'<div class="no-video-container">' +
													'<i class="fa fa-video-camera fa-5 no-video-icon"></i>' +
													'<span class="no-video-text">No remote video available</span>' +
												'</div>');
										}
									} else {
										$('#videoright .no-video-container').remove();
										$('#remotevideo').removeClass('hide').show();
									}
									if(!addButtons)
										return;
									// Enable audio/video buttons and bitrate limiter
									audioenabled = true;
									videoenabled = true;
									$('#toggleaudio').html("Disable audio").removeClass("btn-success").addClass("btn-danger")
											.unbind('click').removeAttr('disabled').click(
										function() {
											audioenabled = !audioenabled;
											if(audioenabled)
												$('#toggleaudio').html("Disable audio").removeClass("btn-success").addClass("btn-danger");
											else
												$('#toggleaudio').html("Enable audio").removeClass("btn-danger").addClass("btn-success");
											videocall.send({"message": { "request": "set", "audio": audioenabled }});
										});
									$('#togglevideo').html("Disable video").removeClass("btn-success").addClass("btn-danger")
											.unbind('click').removeAttr('disabled').click(
										function() {
											videoenabled = !videoenabled;
											if(videoenabled)
												$('#togglevideo').html("Disable video").removeClass("btn-success").addClass("btn-danger");
											else
												$('#togglevideo').html("Enable video").removeClass("btn-danger").addClass("btn-success");
											videocall.send({"message": { "request": "set", "video": videoenabled }});
										});
									$('#toggleaudio').parent().removeClass('hide').show();
									$('#bitrateset').html("Bandwidth");
									$('#bitrate a').unbind('click').removeAttr('disabled').click(function() {
										var id = $(this).attr("id");
										var bitrate = parseInt(id)*1000;
										if(bitrate === 0) {
											Janus.log("Not limiting bandwidth via REMB");
										} else {
											Janus.log("Capping bandwidth to " + bitrate + " via REMB");
										}
										$('#bitrateset').html($(this).html()).parent().removeClass('open');
										videocall.send({"message": { "request": "set", "bitrate": bitrate }});
										return false;
									});
									if(Janus.webRTCAdapter.browserDetails.browser === "chrome" || Janus.webRTCAdapter.browserDetails.browser === "firefox" ||
											Janus.webRTCAdapter.browserDetails.browser === "safari") {
										$('#curbitrate').removeClass('hide').show();
										bitrateTimer = setInterval(function() {
											// Display updated bitrate, if supported
											var bitrate = videocall.getBitrate();
											$('#curbitrate').text(bitrate);
											// Check if the resolution changed too
											var width = $("#remotevideo").get(0).videoWidth;
											var height = $("#remotevideo").get(0).videoHeight;
											if(width > 0 && height > 0)
                                                $('#curres').removeClass('hide').text(width+'x'+height).show();
                                            // the return 'bitrate' is like 'XXX kbits/sec', so parsing is need
                                            // bitrate setting controls local encoder, it is the outward speed
                                            // actively limit bitrate once at the beginning
                                            if( (!one_off_limit_flag) && (parseInt(bitrate)*1000 > 1.3 * init_bitrate) ){
                                                toastr.info("Initial bitrate " + bitrate + " too large! limit to: " + init_bitrate/1000 + "kbit/s");
                                                videocall.send({"message": { "request": "set", "bitrate": init_bitrate }});
                                                one_off_limit_flag = true;
                                            }
										}, 1000);
									}
								},
								ondataopen: function(data) {
									Janus.log("The DataChannel is available!");
									$('#videos').removeClass('hide').show();
									$('#datasend').removeAttr('disabled');
								},
								ondata: function(data) {
									Janus.debug("We got data from the DataChannel! " + data);
									$('#datarecv').val(data);
								},
								oncleanup: function() {
									Janus.log(" ::: Got a cleanup notification :::");
									$('#myvideo').remove();
									$('#remotevideo').remove();
									$("#videoleft").parent().unblock();
									$('.no-video-container').remove();
									$('#callee').empty().hide();
									yourusername = null;
									$('#curbitrate').hide();
									$('#curres').hide();
									$('#videos').hide();
									$('#toggleaudio').attr('disabled', true);
									$('#togglevideo').attr('disabled', true);
									$('#bitrate').attr('disabled', true);
									$('#curbitrate').hide();
									$('#curres').hide();
									if(bitrateTimer !== null && bitrateTimer !== null)
										clearInterval(bitrateTimer);
									bitrateTimer = null;
									$('#waitingvideo').remove();
									$('#videos').hide();
									simulcastStarted = false;
									$('#simulcast').remove();
									$('#peer').removeAttr('disabled').val('');
									$('#call').removeAttr('disabled').html('Call')
										.removeClass("btn-danger").addClass("btn-success")
										.unbind('click').click(doCall);
								}
							});
					},
					error: function(error) {
						Janus.error(error);
						bootbox.alert(error, function() {
							window.location.reload();
						});
					},
					destroyed: function() {
						window.location.reload();
					}
				});


        });
    }});
});


function checkEnter(field, event) {
	var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
	if(theCode == 13) {
		if(field.id == 'username')
			registerUsername();
		else if(field.id == 'peer')
			doCall();
		else if(field.id == 'datasend')
			sendData();
		return false;
	} else {
		return true;
	}
}

function registerUsername() {
	// Try a registration
	$('#username').attr('disabled', true);
	$('#register').attr('disabled', true).unbind('click');
	var username = $('#username').val();
	if(username === "") {
		bootbox.alert("Insert a username to register (e.g., pippo)");
		$('#username').removeAttr('disabled');
		$('#register').removeAttr('disabled').click(registerUsername);
		return;
	}
	if(/[^a-zA-Z0-9]/.test(username)) {
		bootbox.alert('Input is not alphanumeric');
		$('#username').removeAttr('disabled').val("");
		$('#register').removeAttr('disabled').click(registerUsername);
		return;
	}
	var register = { "request": "register", "username": username };
	videocall.send({"message": register});
}

function doCall() {
	// Call someone
	$('#peer').attr('disabled', true);
	$('#call').attr('disabled', true).unbind('click');
	var username = $('#peer').val();
	if(username === "") {
		bootbox.alert("Insert a username to call (e.g., pluto)");
		$('#peer').removeAttr('disabled');
		$('#call').removeAttr('disabled').click(doCall);
		return;
	}
	if(/[^a-zA-Z0-9]/.test(username)) {
		bootbox.alert('Input is not alphanumeric');
		$('#peer').removeAttr('disabled').val("");
		$('#call').removeAttr('disabled').click(doCall);
		return;
	}
	// Call this user
	videocall.createOffer(
		{
			// By default, it's sendrecv for audio and video...
			media: { data: true },	// ... let's negotiate data channels as well
			// If you want to test simulcasting (Chrome and Firefox only), then
			// pass a ?simulcast=true when opening this demo page: it will turn
			// the following 'simulcast' property to pass to janus.js to true
			simulcast: doSimulcast,
			success: function(jsep) {
				Janus.debug("Got SDP!");
				Janus.debug(jsep);
				var body = { "request": "call", "username": $('#peer').val() };
				videocall.send({"message": body, "jsep": jsep});
			},
			error: function(error) {
				Janus.error("WebRTC error...", error);
				bootbox.alert("WebRTC error... " + error);
			}
		});
}

function doHangup() {
	// Hangup a call
	$('#call').attr('disabled', true).unbind('click');
	var hangup = { "request": "hangup" };
	videocall.send({"message": hangup});
	videocall.hangup();
	yourusername = null;
}

// Helper to parse query string
function getQueryStringValue(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
		results = regex.exec(location.search);
	return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

/* 
$('#start').one('click', function() {
    console.log("start button clicked!");
    $(this).attr('disabled', true).unbind('click');

    if (navigator.getUserMedia) {
        navigator.getUserMedia({video:true, audio:true}, onSuccess, onError);
    } else {
        console.log("Ah.. No cam found, use fungible mp4 instead..");
        document.getElementById('webcam').src = 'somevideo.mp4';
    }
}); */