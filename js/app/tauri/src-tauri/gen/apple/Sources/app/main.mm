#include "bindings/bindings.h"
#import <UIKit/UIKit.h>

extern "C" void on_app_resumed(void);

@interface AppLifecycleObserver : NSObject
@end

@implementation AppLifecycleObserver

+ (void)load {
	__block BOOL isFirstActivation = YES;

	[[NSNotificationCenter defaultCenter]
		addObserverForName:UIApplicationDidBecomeActiveNotification
					object:nil
					 queue:[NSOperationQueue mainQueue]
				usingBlock:^(NSNotification * _Nonnull note) {
					if (isFirstActivation) {
						isFirstActivation = NO;
						return;
					}
					on_app_resumed();
				}];
}

@end

int main(int argc, char * argv[]) {
	ffi::start_app();
	return 0;
}
