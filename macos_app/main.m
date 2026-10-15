#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) WKWebView *webView;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    // 1. Configuration de WKWebView
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKPreferences *preferences = config.preferences;
    
    // Autoriser l'accès aux fichiers locaux (IndexedDB, images, libs, PDF)
    [preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];
    @try {
        [config setValue:@YES forKey:@"allowUniversalAccessFromFileURLs"];
    } @catch (NSException *e) {}
    
    // Activer l'inspecteur Web (Option-Cmd-I)
    [preferences setValue:@YES forKey:@"developerExtrasEnabled"];
    
    // 2. Fenêtre Principale macOS Native
    NSRect screenRect = [[NSScreen mainScreen] visibleFrame];
    CGFloat winWidth = MIN(1280.0, screenRect.size.width * 0.90);
    CGFloat winHeight = MIN(880.0, screenRect.size.height * 0.90);
    NSRect windowRect = NSMakeRect((screenRect.size.width - winWidth) / 2.0,
                                   (screenRect.size.height - winHeight) / 2.0,
                                   winWidth, winHeight);
    
    NSWindowStyleMask styleMask = NSWindowStyleMaskTitled |
                                  NSWindowStyleMaskClosable |
                                  NSWindowStyleMaskMiniaturizable |
                                  NSWindowStyleMaskResizable |
                                  NSWindowStyleMaskFullSizeContentView;
    
    self.window = [[NSWindow alloc] initWithContentRect:windowRect
                                              styleMask:styleMask
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    
    self.window.title = @"L'antre du caddrillage";
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.titlebarAppearsTransparent = YES;
    self.window.minSize = NSMakeSize(780, 520);
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:0.06 green:0.06 blue:0.08 alpha:1.0];
    self.window.delegate = self;
    
    // 3. Initialisation de la WebKit View
    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;
    
    // Décoration et transparence
    [self.webView setValue:@NO forKey:@"drawsBackground"];
    
    [self.window.contentView addSubview:self.webView];
    
    // 4. Construction des Menus macOS Natifs
    [self setupMainMenu];
    
    // 5. Chargement de l'application (bundle ou fallback courant)
    [self loadAppContent];
    
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)setupMainMenu {
    NSMenu *menubar = [[NSMenu alloc] init];
    
    // Menu App
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:@"À propos de L'antre du caddrillage" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Masquer l'application" action:@selector(hide:) keyEquivalent:@"h"];
    NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Masquer les autres" action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
    [hideOthers setKeyEquivalentModifierMask:(NSEventModifierFlagOption | NSEventModifierFlagCommand)];
    [appMenu addItemWithTitle:@"Tout afficher" action:@selector(unhideAllApplications:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Quitter L'antre du caddrillage" action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];
    
    // Menu Édition (Indispensable pour Cmd+C, Cmd+V, Cmd+A, Cmd+Z dans les champs texte)
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Édition"];
    [editMenu addItemWithTitle:@"Annuler" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Rétablir" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Couper" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copier" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Coller" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Tout sélectionner" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editMenuItem setSubmenu:editMenu];
    
    // Menu Présentation
    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:viewMenuItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"Présentation"];
    [viewMenu addItemWithTitle:@"Recharger la page" action:@selector(reloadPage:) keyEquivalent:@"r"];
    [viewMenu addItemWithTitle:@"Zoom avant" action:@selector(zoomIn:) keyEquivalent:@"+"];
    [viewMenu addItemWithTitle:@"Zoom arrière" action:@selector(zoomOut:) keyEquivalent:@"-"];
    [viewMenu addItemWithTitle:@"Taille réelle" action:@selector(resetZoom:) keyEquivalent:@"0"];
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItemWithTitle:@"Activer/Désactiver le plein écran" action:@selector(toggleFullScreen:) keyEquivalent:@"f"];
    [viewMenuItem setSubmenu:viewMenu];
    
    // Menu Fenêtre
    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:windowMenuItem];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Fenêtre"];
    [windowMenu addItemWithTitle:@"Réduire" action:@selector(miniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"Zoomer" action:@selector(zoom:) keyEquivalent:@""];
    [windowMenuItem setSubmenu:windowMenu];
    
    [NSApp setMainMenu:menubar];
}

- (void)reloadPage:(id)sender {
    [self.webView reload];
}

- (void)zoomIn:(id)sender {
    self.webView.pageZoom += 0.1;
}

- (void)zoomOut:(id)sender {
    if (self.webView.pageZoom > 0.4) {
        self.webView.pageZoom -= 0.1;
    }
}

- (void)resetZoom:(id)sender {
    self.webView.pageZoom = 1.0;
}

- (void)loadAppContent {
    NSURL *resourceURL = [[NSBundle mainBundle] resourceURL];
    NSURL *indexURL = [resourceURL URLByAppendingPathComponent:@"index.html"];
    
    // Si index.html n'est pas dans Resources (mode dev / test en ligne de commande)
    if (![[NSFileManager defaultManager] fileExistsAtPath:indexURL.path]) {
        NSString *currentPath = [[NSFileManager defaultManager] currentDirectoryPath];
        indexURL = [NSURL fileURLWithPath:[currentPath stringByAppendingPathComponent:@"index.html"]];
        resourceURL = [NSURL fileURLWithPath:currentPath];
    }
    
    if ([[NSFileManager defaultManager] fileExistsAtPath:indexURL.path]) {
        [self.webView loadFileURL:indexURL allowingReadAccessToURL:resourceURL];
    } else {
        NSString *htmlError = @"<html><body style='background:#111;color:#eee;font-family:sans-serif;padding:40px;'>"
                               "<h2>Fichier index.html introuvable</h2>"
                               "<p>Vérifiez que le contenu de l'application est bien placé dans le dossier Resources.</p>"
                               "</body></html>";
        [self.webView loadHTMLString:htmlError baseURL:nil];
    }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *targetURL = navigationAction.request.URL;
    
    // Si l'utilisateur clique sur un lien externe web (Instagram, liens web externes)
    if (navigationAction.navigationType == WKNavigationTypeLinkActivated) {
        if ([targetURL.scheme isEqualToString:@"http"] || [targetURL.scheme isEqualToString:@"https"]) {
            // Ouvrir dans le navigateur par défaut de l'utilisateur (Safari, Chrome...)
            [[NSWorkspace sharedWorkspace] openURL:targetURL];
            decisionHandler(WKNavigationActionPolicyCancel);
            return;
        }
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

// Support des liens avec target="_blank"
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    if (navigationAction.targetFrame == nil) {
        NSURL *url = navigationAction.request.URL;
        if (url) {
            [[NSWorkspace sharedWorkspace] openURL:url];
        }
    }
    return nil;
}

#pragma mark - WKUIDelegate (Alertes / Confirmations Javascript)

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"L'antre du caddrillage"];
    [alert setInformativeText:message];
    [alert addButtonWithTitle:@"OK"];
    [alert runModal];
    completionHandler();
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"L'antre du caddrillage"];
    [alert setInformativeText:message];
    [alert addButtonWithTitle:@"Confirmer"];
    [alert addButtonWithTitle:@"Annuler"];
    NSModalResponse response = [alert runModal];
    completionHandler(response == NSAlertFirstButtonReturn);
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        [app setDelegate:delegate];
        [app run];
    }
    return 0;
}
